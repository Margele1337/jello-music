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
     * 便捷方法：实数信号 → 幅度谱。
     *
     * @param samples 实数采样，长度须为 size
     * @return 长度 size/2 的幅度谱（已归一化到 0..1）
     */
    public double[] magnitudes(double[] samples) {
        if (samples.length != size) {
            throw new IllegalArgumentException("采样长度必须为 " + size + "，收到 " + samples.length);
        }
        double[] re = new double[size];
        double[] im = new double[size];
        // 加 Hann 窗，减少频谱泄漏
        for (int i = 0; i < size; i++) {
            double w = 0.5 * (1 - Math.cos(2.0 * Math.PI * i / (size - 1)));
            re[i] = samples[i] * w;
        }
        transform(re, im);

        double[] out = new double[size / 2];
        double max = 1e-9;
        for (int i = 0; i < size / 2; i++) {
            out[i] = Math.hypot(re[i], im[i]);
            if (out[i] > max) {
                max = out[i];
            }
        }
        for (int i = 0; i < out.length; i++) {
            out[i] /= max;
        }
        return out;
    }
}