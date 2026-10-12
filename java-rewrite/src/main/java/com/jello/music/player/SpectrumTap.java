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
    /**
     * 已解码的采样数（单声道计）。
     *
     * <p>原版靠「预读 Audio 领先主播放器 leadMs」来实现频谱领先声音。
     * Java 侧没有第二个播放器，改成按字节位置做基准，
     * 由 {@link com.jello.music.player.SpectrumFeed} 拿它和播放位置对齐。
     */
    private long decodedSamples;

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

    /** 已解码的采样数（单声道计），用于与播放位置对齐。 */
    public long decodedSampleCount() {
        return decodedSamples;
    }

    /** 已解码音频对应的播放秒数；采样率未知时返回 0。 */
    public double decodedSeconds() {
        return sampleRate > 0 ? decodedSamples / (double) sampleRate : 0;
    }

    /**
     * 解码一帧并返回<b>原始</b>幅度谱（不归一化）。
     *
     * <p>对应原版 {@code PlayerEngine.vue} 的 {@code spectrumRaw}：直接对
     * 1024 点 FFT 逐点取 {@code sqrt(re*re+im*im)}，不归一化也不分箱。
     *
     * @return 长度 fftSize/2 的原始幅度谱；流结束时返回 null
     */
    public double[] nextRawFrame() throws IOException {
        double[] mono = new double[fft.size()];
        if (decodeInto(mono) == 0) {
            return null;
        }
        return fft.rawMagnitudes(mono);
    }

    /**
     * 往 {@code mono} 里解满一帧（单声道、Int16 原始量纲），返回写入的采样数。
     *
     * @return 实际填充数；0 表示流已结束
     */
    private int decodeInto(double[] mono) {
        int want = Math.min(fft.size(), mono.length);
        int filled = 0;

        while (filled < want) {
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
            // 量纲按 mod 权威实现 MathHelper.convertToPCMFloatArray:21-30：
            //   pcmValues[i] = (float) sample / 32768.0F;
            // 即归一化到 -1..1 的 float。
            //
            // 注意别被 Electron 版的 spectrumTapProcessor 带偏——那边是 Int16Array
            // 不除 32768，是 Electron 侧为了对齐 sigmarebase 自己补的一层近似。
            // 本项目按 sigmarebase（sigmarebase）的原始实现走。
            int consumed;
            if (channels == 1) {
                consumed = Math.min(len, want - filled);
                for (int i = 0; i < consumed; i++) {
                    mono[filled + i] = buf[i] / 32768.0;
                }
                filled += consumed;
            } else {
                // 交错 L R L R...，只取左声道，避免左右混叠影响频谱
                int pairs = len / 2;
                consumed = Math.min(pairs, want - filled);
                for (int i = 0; i < consumed; i++) {
                    mono[filled + i] = buf[i * 2] / 32768.0;
                }
                filled += consumed;
            }
            decodedSamples += consumed;
        }

        if (filled > 0) {
            decodedFrames++;
        }
        return filled;
    }

    /**
     * 探针专用：解码一帧并返回<b>归一化到 0..1</b>的幅度谱。
     *
     * <p>只有 {@code PipelineProbe} 用它来看「频谱形状对不对」。
     * 渲染链路必须走 {@link #nextRawFrame()}——那边是不归一化的原始量纲。
     *
     * @return 归一化幅度谱；流结束时返回 null
     */
    public double[] frameForProbe() throws IOException {
        double[] mono = new double[fft.size()];
        int filled = decodeInto(mono);
        if (filled == 0) {
            return null;
        }
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
     * 取幅度谱的前 {@code bars} 个 bin —— 1:1 复刻原版 {@code spectrumRaw}。
     *
     * <p><b>不要分箱、不要归一化。</b>原版是 {@code SPECTRUM_BAR_COUNT = 114} 根条，
     * 每根直接对应 FFT 输出的一个 bin（1024 点 FFT 出 512 个 bin，前 114 个用上）。
     * 之前 Java 版用的是「48 个对数间隔频段的均值」，那是人耳感知的通用做法，
     * 但和原版的 Sigma 形态完全不是一回事，低频会被过度合并。
     *
     * @param magnitudes 原始幅度谱，长度 ≥ bars
     * @param bars条数，对应原版 {@code SPECTRUM_BAR_COUNT}
     * @return 长度恰为 bars 的数组，不足处补 0
     */
    public static double[] takeBins(double[] magnitudes, int bars) {
        double[] out = new double[bars];
        System.arraycopy(magnitudes, 0, out, 0, Math.min(bars, magnitudes.length));
        return out;
    }

    /**
     * 把幅度谱分箱到 n 个对数间隔的频段。
     *
     * @deprecated 仅 {@code PipelineProbe} 用来看频谱形状；渲染链路走 {@link #takeBins}。
     */
    @Deprecated
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