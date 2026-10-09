package com.jello.music.player;

import javazoom.jl.decoder.Bitstream;
import javazoom.jl.decoder.Decoder;
import javazoom.jl.decoder.Header;
import javazoom.jl.decoder.Obuffer;
import javazoom.jl.decoder.SampleBuffer;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * 旁路频谱采集：从音频直链拉流，用纯 Java MP3 解码器（JLayer 1.0.1）拿到 PCM，算 FFT。
 *
 * <p><b>为什么可以旁路</b>：已实测酷狗直链<b>不校验 UA / Referer</b>，
 * 且支持 HTTP Range（返回 206），所以这里可以只取流的前若干 MB 做分析，
 * 不必整首下载，也不必等播放开始——这解决了 JavaFX MediaPlayer 不吐 PCM 的问题。
 *
 * <p><b>代价</b>：解码与播放是两条独立路径，进度需各自维护。当前阶段只做「取一段算频谱」
 * 用于验证链路；接入真实播放后应改为跟随播放位置增量取流。
 *
 * <p><b>JLayer 1.0.1 的 API 形态</b>（与 1.0.2+ 不同，别照新版教程写）。踩过的点：
 * <ul>
 *   <li>{@code new Decoder()} 无参构造，先 {@code setOutputBuffer(SampleBuffer)}</li>
 *   <li>每帧 {@code bitstream.readFrame()} 拿 Header，再 {@code decodeFrame(header, bitstream)}</li>
 *   <li>清空输出用 {@code clear_buffer()}，没有 reset()</li>
 *   <li>{@code Header} 没有 getSampleRate()/getChannels()，用 {@code frequency()}
 *       与 {@code SampleBuffer.getChannelCount()}</li>
 *   <li>{@code OBUFFERSIZE} / {@code MAXCHANNELS} 在 {@code Obuffer} 上，不在 {@code Decoder}</li>
 * </ul>
 */
public final class SpectrumTap implements AutoCloseable {

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final HttpResponse<InputStream> response;
    private final Bitstream bitstream;
    private final Decoder decoder;
    private final SampleBuffer sampleBuffer;
    private final Fft fft;

    private int sampleRate;
    private int channels;
    private long decodedFrames;

    public SpectrumTap(String directUrl, int fftSize) throws IOException {
        this.fft = new Fft(fftSize);

        HttpRequest req = HttpRequest.newBuilder(URI.create(directUrl))
                .timeout(Duration.ofSeconds(60))
                .header("Accept", "*/*")
                .GET()
                .build();
        try {
            this.response = HTTP.send(req, HttpResponse.BodyHandlers.ofInputStream());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("拉流被中断", e);
        }
        int code = response.statusCode();
        if (code != 200 && code != 206) {
            response.body().close();
            throw new IOException("拉流失败 HTTP " + code);
        }

        InputStream in = new BufferedInputStream(response.body(), 1 << 16);
        this.bitstream = new Bitstream(in);
        this.decoder = new Decoder();
        this.sampleBuffer = new SampleBuffer(Obuffer.OBUFFERSIZE, Obuffer.MAXCHANNELS);
        this.decoder.setOutputBuffer(sampleBuffer);
    }

    public int sampleRate() {
        return sampleRate;
    }

    public int channels() {
        return channels;
    }

    public long decodedFrameCount() {
        return decodedFrames;
    }

    /**
     * 解码一帧并返回幅度谱。
     *
     * @return 长度 fftSize/2 的 0..1 幅度谱；流结束时返回 null
     */
    public double[] nextFrame() throws IOException {
        double[] mono = new double[fft.size()];
        int filled = 0;

        while (filled < fft.size()) {
            Header header;
            try {
                header = bitstream.readFrame();
            } catch (Exception e) {
                break; // 读到不完整帧
            }
            if (header == null) {
                break; // 流结束
            }
            try {
                decoder.decodeFrame(header, bitstream);
            } catch (Exception e) {
                break;
            }
            // 必须调用：decodeFrame 依赖它把输入流推进到下一帧的起点，
            // 漏掉的话流位置不动，后续每次 readFrame 都读到同一帧，解出全零。
            bitstream.closeFrame();

            sampleRate = header.frequency();
            channels = sampleBuffer.getChannelCount();

            short[] buf = sampleBuffer.getBuffer();
            int len = sampleBuffer.getBufferLength();
            sampleBuffer.clear_buffer();

            if (len <= 0) {
                break;
            }
            // short 全幅 32767/32768，除掉得到 -1..1
            if (channels == 1) {
                int take = Math.min(len, fft.size() - filled);
                for (int i = 0; i < take; i++) {
                    mono[filled + i] = buf[i] / 32768.0;
                }
                filled += take;
            } else {
                // 交错 L R L R...，只取左声道，避免左右混叠影响频谱
                int pairs = len / 2;
                int want = Math.min(pairs, fft.size() - filled);
                for (int i = 0; i < want; i++) {
                    mono[filled + i] = buf[i * 2] / 32768.0;
                }
                filled += want;
            }
        }

        if (filled == 0) {
            return null;
        }
        decodedFrames++;
        return fft.magnitudes(mono);
    }

    @Override
    public void close() {
        try {
            bitstream.close();
        } catch (Exception ignored) {
            // 关闭失败无需处理
        }
        try {
            response.body().close();
        } catch (IOException ignored) {
            // 同上
        }
    }

    /**
     * 把幅度谱分箱到 n 个对数间隔的频段（更接近人耳感知，也和现有 UI 的柱状图对应）。
     */
    public static double[] toLogBands(double[] magnitudes, int bands) {
        double[] out = new double[bands];
        int n = magnitudes.length;
        for (int b = 0; b < bands; b++) {
            double lo = Math.pow(n, (double) b / bands) - 1;
            double hi = Math.pow(n, (double) (b + 1) / bands) - 1;
            int i0 = Math.max(0, (int) Math.floor(lo));
            int i1 = Math.min(n, (int) Math.ceil(hi));
            if (i1 <= i0) {
                i1 = Math.min(n, i0 + 1);
            }
            double sum = 0;
            for (int i = i0; i < i1; i++) {
                sum += magnitudes[i];
            }
            out[b] = sum / (i1 - i0);
        }
        return out;
    }
}