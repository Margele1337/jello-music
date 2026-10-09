package com.jello.music.player;

import java.io.IOException;
import java.util.Arrays;

/**
 * 把 {@link SpectrumTap} 放到后台线程持续取频谱，供 UI 线程安全读取。
 *
 * <p>{@code SpectrumTap.nextFrame()} 是阻塞的（一帧一个 MP3 帧约 26ms），
 * 绝不能放在 JavaFX 的 UI 线程里调用，否则界面会卡顿。
 *
 * <p>这里用「单槽位」策略：后台只保留最新一帧，UI 读到就用、读不到就沿用上一帧。
 * 频谱本身是短时信号，丢帧比堆积延迟更合理——UI 掉帧时宁可少显示一帧，
 * 也不希望渲染一个几百毫秒前的过期频谱。
 */
public final class SpectrumFeed implements AutoCloseable {

    private final SpectrumTap tap;
    private volatile double[] latest;
    private volatile double[] bands;
    private volatile boolean running = true;
    private volatile String error;
    private final int bandCount;
    private final Thread worker;

    public SpectrumFeed(String directUrl, int fftSize, int bandCount, int fps) {
        this.bandCount = bandCount;
        if (directUrl == null || directUrl.isBlank()) {
            // 没有直链时不启动后台线程，界面照常显示，只是没有频谱
            this.tap = null;
            this.error = "未提供音频直链";
            this.worker = null;
            return;
        }
        SpectrumTap t;
        try {
            t = new SpectrumTap(directUrl, fftSize);
        } catch (IOException e) {
            // 拉流失败也让对象可用，只是没有频谱
            this.tap = null;
            this.error = e.getMessage();
            this.worker = null;
            return;
        }
        this.tap = t;

        long intervalNanos = 1_000_000_000L / Math.max(1, fps);
        this.worker = new Thread(() -> {
            while (running) {
                try {
                    double[] frame = tap.nextFrame();
                    if (frame == null) {
                        // 流结束
                        break;
                    }
                    double[] b = SpectrumTap.toLogBands(frame, bandCount);
                    // 轻微平滑，避免柱状图跳动过于生硬
                    double[] prev = bands;
                    if (prev != null && prev.length == b.length) {
                        for (int i = 0; i < b.length; i++) {
                            b[i] = Math.max(b[i], prev[i] * 0.82); // 峰值保持 + 缓慢回落
                        }
                    }
                    this.latest = frame;
                    this.bands = b;
                } catch (Exception e) {
                    this.error = e.getMessage();
                    break;
                }
                try {
                    Thread.sleep(intervalNanos / 1_000_000L, (int) (intervalNanos % 1_000_000L));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }, "spectrum-feed");
        this.worker.setDaemon(true);
        this.worker.start();
    }

    /** 取当前频段数据；尚未就绪时返回 null。返回的数组不可被调用方修改。 */
    public double[] bands() {
        return bands;
    }

    public double[] latestFrame() {
        return latest;
    }

    public int sampleRate() {
        return tap == null ? 0 : tap.sampleRate();
    }

    public int channels() {
        return tap == null ? 0 : tap.channels();
    }

    public String error() {
        return error;
    }

    public boolean isRunning() {
        return running && (worker == null || worker.isAlive());
    }

    @Override
    public void close() {
        running = false;
        if (worker != null) {
            worker.interrupt();
        }
        if (tap != null) {
            tap.close();
        }
    }
}