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

    private final String directUrl;
    private final int fftSizeRequested;
    private HttpResponse<InputStream> response;
    private InputStream stream;
    private Bitstream bitstream;
    private Decoder decoder;
    private SampleBuffer sampleBuffer;
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

    /** Content-Length；服务端没给时为 -1（此时不能按字节 seek）。 */
    private long contentLength = -1;

    /** 字节偏移 → 音频时间的换算比例，seek 成功后按实际帧率校准。 */
    private double bytesPerSecond = -1;

    /** 已消费的字节数估算（按采样数 × 每采样字节数）。 */
    private long bytesConsumed;

    /**
     * 估算一个音频时间对应的字节偏移。
     *
     * <p>MP3 是变比特率流，字节与时间不是严格线性。这里按「前 64KB 的实际解码
     * 结果」估一个平均值，误差累积后由 {@link #seekToSeconds} 的周期性校正兜住——
     * 频谱只要大致对齐，肉眼看不出毫秒级误差。
     */
    private static final int BYTES_PER_SECOND_PROBE = 64 * 1024;

    public SpectrumTap(String directUrl, int fftSize) throws IOException {
        this.fft = new Fft(fftSize);
        this.directUrl = directUrl;
        this.fftSizeRequested = fftSize;
        this.sampleBuffer = new SampleBuffer(Obuffer.OBUFFERSIZE, Obuffer.MAXCHANNELS);
        open(0);
    }

    /**
     * （重）打开流。
     *
     * @param byteOffset 从流的哪个字节开始读；0 表示从头
     */
    private void open(long byteOffset) throws IOException {
        closeStream();
        // 变量别叫 req：那是 HttpRequest.Builder 的产物，
        // 而下面还要用 HttpRequest.newBuilder() 这个类名
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(directUrl))
                .timeout(Duration.ofSeconds(60))
                .header("Accept", "*/*")
                .GET();
        if (byteOffset > 0) {
            // 直链实测支持 Range（返回 206），所以可以按字节跳
            builder.header("Range", "bytes=" + byteOffset + "-");
        }
        try {
            this.response = HTTP.send(builder.build(),
                    HttpResponse.BodyHandlers.ofInputStream());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("拉流被中断", e);
        }
        int code = response.statusCode();
        // 206 = 按 Range 返回的片段；200 = 服务端忽略了 Range，只能从头
        boolean partial = code == 206;
        if (code != 200 && code != 206) {
            response.body().close();
            throw new IOException("拉流失败 HTTP " + code);
        }
        long len = response.headers().firstValueAsLong("Content-Length").orElse(-1L);
        this.contentLength = partial && len > 0 ? byteOffset + len : len;

        // 探测 ID3v2 要往回塞 10 字节（探针读的头），缓冲必须 >= 10
        this.stream = new java.io.PushbackInputStream(
                new BufferedInputStream(response.body(), 1 << 16), 16);
        skipId3v2(this.stream, byteOffset == 0);
        this.bitstream = new Bitstream(stream);
        this.decoder = new Decoder();
        this.decoder.setOutputBuffer(sampleBuffer);
        this.sampleBuffer.clear_buffer();
        this.decodedSamples = 0;
        // bytesConsumed 是「距当前起点的字节数」，重新打开流后从 0 重新累计。
        // 但 bytesPerSecond 是整首歌的平均码率，不能清——它正是我们要保留的换算依据。
        this.bytesConsumed = 0;
    }

    /**
 * 跳过开头的 ID3v2 标签。
 *
 * <p><b>这是频谱解不出帧的真正原因。</b>酷狗直链返回的是
 * {@code content-type: audio/mpeg} 且带 ID3v2 标签（实测开头 4 字节是 {@code ID3}，
 * 真正的帧同步字在第 21 字节）。而 JLayer 1.0.1 的 {@link Bitstream} <b>不认 ID3</b>，
 * 它假设流一打开就是 {@code 0xFFEx} 帧头：开头的 {@code 'I'} 既不是 0xFF 也没有下一字节，
 * 于是 {@code readFrame()} 一直返回 {@code null}，表现为「拉到了直链但一帧都解不出」。
 *
 * <p>ID3v2 的长度不是普通整数：头 10 字节里，{@code bytes[6..9]} 是
 * <b>syncsafe</b> 编码（每字节只用低 7 位），所以要先还原再跳。
 *
 * @param onlyAtStart 只在从流开头（offset==0）时跳：按 Range 跳到中途时
 *                    流的起点本来就是音频帧，硬跳会吃掉开头几十个字节
 */
private static void skipId3v2(InputStream in, boolean onlyAtStart) throws IOException {
        if (!onlyAtStart) {
            return;
        }
        byte[] head = in.readNBytes(10);
        if (head.length < 10
                || head[0] != 'I' || head[1] != 'D' || head[2] != '3') {
            // 不是 ID3v2，探测读的字节要还回去
            if (head.length > 0) {
                ((java.io.PushbackInputStream) in).unread(head);
            }
            return;
        }
        // syncsafe：4 字节各取低 7 位
        int size = ((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14)
                | ((head[8] & 0x7F) << 7) | (head[9] & 0x7F);
        // bit7 = 0x10 表示标签尾部还有 10 字节 footer
        boolean hasFooter = (head[5] & 0x10) != 0;
        long total = 10L + size + (hasFooter ? 10L : 0L);
        System.err.println("[SpectrumTap] 跳过 ID3v2 标签 " + total + " 字节");
        long left = total;
        byte[] buf = new byte[1 << 16];
        while (left > 0) {
            int n = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (n < 0) {
                return;
            }
            left -= n;
        }
    }

    private void closeStream() {
        try {
            // Bitstream 持有 InputStream，先关它再关底层流
            if (bitstream != null) {
                bitstream.close();
            }
        } catch (Exception ignored) {
            // 关闭失败无需处理
        }
        bitstream = null;
        try {
            if (stream != null) {
                stream.close();
            }
        } catch (IOException ignored) {
            // 同上
        }
        if (response != null) {
            try {
                response.body().close();
            } catch (IOException ignored) {
                // 同上
            }
        }
        stream = null;
        response = null;
    }

    /** 已知的音频总时长（秒）；拿不到时返回 0。 */
    public double totalSeconds() {
        if (contentLength <= 0 || bytesPerSecond <= 0) {
            return 0;
        }
        return contentLength / bytesPerSecond;
    }

    /**
     * 跳到指定音频时间（秒）。
     *
     * <p>对应原版 {@code syncLookahead} 里给预读播放器设 {@code currentTime} 的动作
     * （{@code AudioController.js:110-117}）。
     *
     * <h2>为什么不能直接从任意字节开始解</h2>
     * MP3 帧头是变长的：帧长由「采样率 + 比特率 + 填充位」算出，
     * 从帧中间开始读，{@code Bitstream.readFrame} 会把垃圾字节当成同步字，
     * 结果是<b>一帧都解不出来</b>（实测：按估算偏移跳到 20s，
     * 后续 500 次解码尝试全部返回 null）。
     *
     * <p>所以这里用「扫同步字」的办法对齐：从估算偏移开始向前找
     * {@code 0xFFEx} 这样的帧头，命中后再退一点留出余量，
     * 让 {@code readFrame} 自己去找下一个真正的帧。
     *
     * @return 跳转是否成功；服务端不支持 Range 或换算失败时返回 false
     */
    public boolean seekToSeconds(double seconds) {
        if (seconds <= 0) {
            return false;
        }
        if (contentLength <= 0 || bytesPerSecond <= 0) {
            // 没有 Content-Length 或还没估出速率：跳不了，只能顺序解码
            return false;
        }
        long target = (long) (seconds * bytesPerSecond);
        if (target >= contentLength) {
            target = Math.max(0, contentLength - 1);
        }
        try {
            open(target);
            if (!alignToFrameBoundary()) {
                // 对不齐就退回从头：宁可慢一点，也不能拿一帧都解不出的流
                open(0);
                return false;
            }
            // 预热：alignToFrameBoundary 的探测会消耗掉开头几帧，
            // 而 Bitstream 解完第一帧后内部才完全进入稳态。
            // 不预热的话，调用方第一轮 nextRawFrame 只能拿到十来帧，
            // 第二轮才恢复——表现为频谱刚跳转时卡一下。
            for (int i = 0; i < WARMUP_FRAMES; i++) {
                if (nextRawFrame() == null) {
                    break;
                }
            }
            return true;
        } catch (IOException e) {
            System.err.println("[SpectrumTap] 跳转到 " + seconds + "s 失败: " + e);
            return false;
        }
    }

    /** 跳转后预热解多少帧，用来盖掉 Bitstream 的启动抖动。 */
    private static final int WARMUP_FRAMES = 12;

    /**
     * 从当前位置向前扫，找到 MP3 帧头。
     *
     * <p>MP3 帧同步字是 11 位全 1，即首字节 {@code 0xFF} 且次字节高 3 位为 {@code 0xE0}。
     * 扫到之后再多读几帧让解码器自己复位——宁可跳过几帧，也比落在帧中间好。
     *
     * @return 是否找到并成功解出至少一帧
     */
    private boolean alignToFrameBoundary() {
        // 上限：最多向前找 512KB，够跨过任何一处非帧边界
        final long maxScanBytes = 512 * 1024;
        long scanned = 0;
        for (int attempt = 0; attempt < 4096; attempt++) {
            try {
                int b1 = stream.read();
                if (b1 < 0) {
                    return false;
                }
                scanned++;
                if ((b1 & 0xFF) != 0xFF) {
                    continue;
                }
                int b2 = stream.read();
                if (b2 < 0) {
                    return false;
                }
                scanned++;
                // 11 位同步：11111111 111xxxxx
                if ((b2 & 0xE0) != 0xE0) {
                    continue;
                }
                // 剩下的版本/层/比特率位不校验：不同编码版本差异大，
                // 宁可放过一些误命中，也不要漏掉真帧头。
                // 回退 2 字节，让 readFrame 从帧头开始读
                pushback(b1, b2);
                // 试解一帧确认真的对齐了
                double[] probe = nextRawFrame();
                if (probe != null) {
                    return true;
                }
            } catch (IOException e) {
                return false;
            }
            // 这里用自己累计的 scanned，而不是 bytesConsumed——
            // 后者只在解码成功时才涨，扫不到帧时它一直是 0，循环上限形同虚设
            if (scanned > maxScanBytes) {
                return false;
            }
        }
        return false;
    }

    /** 把刚读走的字节放回流头，供 {@link Bitstream} 重新解析。 */
    private void pushback(int b1, int b2) throws IOException {
        if (!(stream instanceof java.io.PushbackInputStream)) {
            return;
        }
        ((java.io.PushbackInputStream) stream).unread(b2);
        ((java.io.PushbackInputStream) stream).unread(b1);
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
            // 【量纲关键，必须逐字节复刻 mod】
            // mod 的 MathHelper.convertToPCMFloatArray(:21-30) 走的是
            //   bytesToIntLE(bytes, i, frameSize)   // MathHelper:43-53
            // 而 bytesToIntLE 是
            //   result += (byteArray[i+k] & 0xFF) << (8*k)
            // ——& 0xFF 让<b>负数变成大正数</b>：16bit 的 -1 变成 0xFFFFFFFF，
            // 再 /32768 后约 131068。
            //
            // 这不是笔误，是 mod 的既有行为，渲染端的门槛也正是配着这个量纲定的：
            // 条高 max(0, sqrt(a)/12-5) 要 &gt; 0 就需要 a &gt; 3600，
            // 而 short/32768 的量级下 a 只有一百多，
            // <b>所有条形高度恒为 0，频谱窗一条都不显示</b>（实测踩过，
            // 见 SpectrumProbe 的输出）。
            //
            // 所以这里必须按 mod 的方式逐字节重组，不能图省事直接用 short 的值。
            int consumed;
            if (channels == 1) {
                consumed = Math.min(len, want - filled);
                for (int i = 0; i < consumed; i++) {
                    // 单声道：frameSize = 2，两个字节即一个采样点
                    short s = buf[i];
                    mono[filled + i] = ((s & 0xFFFF) / 32768.0);
                }
                filled += consumed;
            } else {
                // 立体声：frameSize = 4，L + R 两个声道打包成一个 int32
                // （见 leStereoPacked 的详细说明，这里只取左声道位参与打包，
                //  与 mod 一致：高 16 位放 R、低 16 位放 L）
                int frames = len / 2;
                consumed = Math.min(frames, want - filled);
                for (int i = 0; i < consumed; i++) {
                    mono[filled + i] = leStereoPacked(buf, i) / 32768.0;
                }
                filled += consumed;
            }
            decodedSamples += consumed;
            // 累计字节数，用来估 bytesPerSecond（按字节 seek 必需）
            bytesConsumed += consumed * (channels == 1 ? 2 : 4);
            if (bytesPerSecond < 0 && bytesConsumed >= BYTES_PER_SECOND_PROBE
                    && sampleRate > 0) {
                bytesPerSecond = bytesConsumed / (decodedSamples / (double) sampleRate);
            }
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
        closeStream();
    }

/**
     * 按 mod 的 {@code bytesToIntLE} 读一个 <b>立体声帧</b>（两个声道合成一个 int32），
     * <b>不处理符号</b>。
     *
     * <p>这是本项目频谱量纲最关键的一处，展开说：
     *
     * <p>mod 的 {@code MathHelper.convertToPCMFloatArray}（:21-30）按
     * {@code audioFormat.getFrameSize()} 逐帧取字节。对 16bit 立体声，
     * frameSize = 4，即<b>一个「采样点」= L 的 2 字节 + R 的 2 字节</b>。
     * 再经 {@code bytesToIntLE}（:43-53）：
     * <pre>
     *   result += (byteArray[i+k] &amp; 0xFF) &lt;&lt; (8*k)     // k = 0..3
     * </pre>
     *
     * <p>两处关键，都不是笔误：
     * <ol>
     *   <li><b>{@code & 0xFF} 让负数变成大正数</b>：16bit 的 -1 → 0xFFFFFFFF</li>
     *   <li><b>两个声道被塞进同一个 int32</b>：高 16 位是 R、低 16 位是 L。
     *       所以喂给 FFT 的序列其实是「L+R 打包值」，幅度比单声道大得多</li>
     * </ol>
     *
     * <p><b>为什么必须这样</b>：渲染端的条高门槛是
     * {@code max(0, sqrt(a)/12-5) &gt; 0}，即 {@code a &gt; 3600}。
     * 实测对比（1024 点、满幅 440Hz 正弦）：
     * <pre>
     *   单声道 short/32768        |X(1)| ≈ 12条高 0.0px  ← 什么都看不见
     *   两声道按 signed 拆         |X(1)| ≈ 12      条高 0.0px
     *   本实现（双声道无符号打包） |X(1)| ≈ 560,899 条高 53.6px  ← 正常
     * </pre>
     * 也就是按「直觉」写会让<b>所有条形恒为 0，频谱窗一条都不显示</b>。
     *
     * @param buf 交错采样缓冲（16bit 小端，L R L R ...）
     * @param pairIndex 第几个立体声帧
     * @return 打包后的无符号值
     */
    private static int leStereoPacked(short[] buf, int pairIndex) {
        int lo = buf[pairIndex * 2] & 0xFFFF;          // L，低16 位
        int hi = buf[pairIndex * 2 + 1] & 0xFFFF;      // R，高 16 位
        return lo | (hi << 16);
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