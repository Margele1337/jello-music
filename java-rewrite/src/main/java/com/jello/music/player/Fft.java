package com.jello.music.player;

/**
 * 迭代式 radix-2 FFT（Cooley-Tukey）。
 *
 * <p>纯 Java 实现，无外部依赖。输入长度必须是 2 的幂。
 *
 * <p>为什么需要它：现有频谱依赖浏览器的 Web Audio（{@code AnalyserNode.getByteFrequencyData}），
 * 那条路在 Java 侧不存在。JavaFX 的 {@code MediaPlayer} 也不吐 PCM，
 * 所以由 {@link SpectrumTap} 旁路解码拿到 PCM 后，在这里做变换。
 */
public final class Fft {

    private final int size;
    // 预计算旋转因子，避免每次变换重复算三角函数
    private final double[] cosTable;
    private final double[] sinTable;
    private final int[] reverse;

    public Fft(int size) {
        if (Integer.bitCount(size) != 1) {
            throw new IllegalArgumentException("FFT 长度必须是 2 的幂，收到: " + size);
        }
        this.size = size;
        this.cosTable = new double[size / 2];
        this.sinTable = new double[size / 2];
        for (int i = 0; i < size / 2; i++) {
            double angle = -2.0 * Math.PI * i / size;
            cosTable[i] = Math.cos(angle);
            sinTable[i] = Math.sin(angle);
        }
        // 位反转重排表
        this.reverse = new int[size];
        int bits = Integer.numberOfTrailingZeros(size);
        for (int i = 0; i < size; i++) {
            int r = 0;
            for (int b = 0; b < bits; b++) {
                r = (r << 1) | ((i >>> b) & 1);
            }
            reverse[i] = r;
        }
    }

    public int size() {
        return size;
    }

    /**
     * 原地复数 FFT。re/im 长度必须等于构造时的 size。
     */
    public void transform(double[] re, double[] im) {
        if (re.length != size || im.length != size) {
            throw new IllegalArgumentException("输入长度必须为 " + size);
        }
        // 位反转重排
        for (int i = 0; i < size; i++) {
            int j = reverse[i];
            if (j > i) {
                double tr = re[i]; re[i] = re[j]; re[j] = tr;
                double ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        // 蝶形运算
        for (int len = 2; len <= size; len <<= 1) {
            int half = len >> 1;
            int step = size / len;
            for (int i = 0; i < size; i += len) {
                for (int j = 0, k = 0; j < half; j++, k += step) {
                    double wr = cosTable[k];
                    double wi = sinTable[k];
                    int a = i + j;
                    int b = a + half;
                    double xr = re[b] * wr - im[b] * wi;
                    double xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                }
            }
        }
    }

/**
 * 实数信号 → <b>原始</b>幅度谱（不加窗、不归一化）。频谱渲染链路的唯一入口。
 *
 * <p>1:1 对应 sigmarebase {@code MathHelper.calculateAmplitudes}（:32-41）：
 * <pre>
 *   double[] amplitudes = new double[realPart.length / 2];
 *   for (int i = 0; i&lt;amplitudes.length; i++)
 *       amplitudes[i] = Math.sqrt(realPart[i]*realPart[i] + imaginaryPart[i]*imaginaryPart[i]);
 * </pre>
 *
 * <p>配合 {@code JavaFFT.transform}（:48-53）——那一版<b>没有窗函数</b>，
 * 直接把输入搬进输出。所以这里也不加窗：加了量纲就偏小，与原版对不上。
 *
 * <p><b>输入量纲</b>是 {@code MathHelper.convertToPCMFloatArray} 产出的 -1..1，
 * 即调用方负责除 32768；本方法不再做缩放，也<b>不归一化</b>——
 * 渲染端用的是 {@code sqrt(amplitudes)/12 - 5} 这种绝对公式，
 * 上游一旦归一化，条高就整体不对了。
 *
 * @param samples 实数采样，长度须为 size
 * @return 长度 size/2 的原始幅度谱
 */
public double[] rawMagnitudes(double[] samples) {
        if (samples.length != size) {
            throw new IllegalArgumentException("采样长度必须为 " + size + "，收到 " + samples.length);
        }
        double[] re = new double[size];
        double[] im = new double[size];
        System.arraycopy(samples, 0, re, 0, size);
        transform(re, im);

        double[] out = new double[size / 2];
        for (int i = 0; i < size / 2; i++) {
            out[i] = Math.hypot(re[i], im[i]);
        }
        return out;
    }

    /**
     * 实数信号 → 幅度谱，加 Hann 窗后按本帧峰值归一化到 0..1。
     *
     * <p>给 {@code PipelineProbe} 这类只想看「形状对不对」的诊断用途。
     * <b>频谱渲染链路不要用这个</b>——原版既不加窗也不归一化，见 {@link #rawMagnitudes}。
     *
     * @param samples 实数采样，长度须为 size
     * @return 长度 size/2 的幅度谱（已归一化到 0..1）
     */
    public double[] magnitudes(double[] samples) {
        if (samples.length != size) {
            throw new IllegalArgumentException("采样长度必须为 " + size + "，收到 " + samples.length);
        }
        double[] windowed = new double[size];
        for (int i = 0; i < size; i++) {
            double w = 0.5 * (1 - Math.cos(2.0 * Math.PI * i / (size - 1)));
            windowed[i] = samples[i] * w;
        }
        double[] out = rawMagnitudes(windowed);
        double max = 1e-9;
        for (double v : out) {
            if (v > max) {
                max = v;
            }
        }
        for (int i = 0; i < out.length; i++) {
            out[i] /= max;
        }
        return out;
    }
}