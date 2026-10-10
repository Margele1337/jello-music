package com.jello.music.tools;

import com.jello.music.api.KuGouApiClient;
import com.jello.music.api.Playlist;
import com.jello.music.model.KuGouCredentials;
import com.jello.music.model.Song;
import com.jello.music.player.PlayQueue;
import javafx.application.Platform;
import javafx.scene.media.Media;
import javafx.scene.media.MediaPlayer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 播放链路静默实测 —— <b>不显示窗口、不出声</b>。
 *
 * <p>{@code MediaPlayer} 不必挂到 Scene 上，所以只用 {@link Platform#startup}
 * 起工具箱就够；音量钉 0，音频管线照跑但一个样本都不外放。
 *
 * <p><b>线程纪律（这里踩过大坑）</b>：{@code MediaPlayer} 的状态回调
 * （onReady / onEndOfMedia / onError）是在 FX 线程上派发的。第一版把整个测试
 * 写在 {@code Platform.startup(() -> {...})} 的 runnable 里，又在里面
 * {@code ready.await(30s)} —— 等于把 FX 线程自己锁死 30 秒，回调永远送不进来，
 * 于是「Media 就绪」恒为 FAIL，误判成 JavaFX 媒体栈坏了。
 * 正确姿势：FX 线程只负责创建/操作节点，<b>等待一律在主线程做</b>。
 *
 * <p>退出码：0 全过；1 有失败；2 缺少凭据或数据而跳过。
 */
public final class PlaybackProbe {

    private static int failures;

    private PlaybackProbe() {
    }

    public static void main(String[] args) throws Exception {
        String token = env("JELLO_TOKEN");
        String userid = env("JELLO_USERID");
        String dfid = env("JELLO_DFID");
        if (token == null || userid == null || dfid == null) {
            System.out.println("PLAYBACK PROBE: SKIP (缺少 JELLO_TOKEN/USERID/DFID)");
            System.exit(2);
        }

        KuGouCredentials cred = new KuGouCredentials();
        cred.setToken(token);
        cred.setUserid(userid);
        cred.setDfid(dfid);
        KuGouApiClient api = new KuGouApiClient(cred);

        List<Playlist> pls = api.userPlaylists(1, 20);
        Playlist target = pls.stream().filter(p -> p.count() > 0).findFirst().orElse(null);
        if (target == null) {
            System.out.println("PLAYBACK PROBE: SKIP (没有非空歌单)");
            System.exit(2);
        }
        List<Song> songs = api.playlistTracks(target.id(), 1, 50);
        if (songs.isEmpty()) {
            System.out.println("PLAYBACK PROBE: SKIP (歌单内没有歌曲)");
            System.exit(2);
        }

        Song song = songs.get(0);
        String url = api.songUrl(song.getHash(), 320);
        System.out.println("track   : " + song.getTitle() + " / " + song.getArtist());
        System.out.println("duration: " + song.getDurationMs() / 1000 + "s (api 元数据)");

        probeLink(url);

        // 只启动工具箱，runnable 里什么都不阻塞
        Platform.startup(() -> {
        });

        try {
            run(song, url, songs);
        } catch (Throwable t) {
            t.printStackTrace();
            failures++;
        }
        Platform.exit();

        System.out.println(failures == 0 ? "PLAYBACK PROBE: ALL PASS"
                : "PLAYBACK PROBE: " + failures + " FAILURE(S)");
        System.exit(failures == 0 ? 0 : 1);
    }

    /** 在 FX 线程上跑一段代码，主线程等它做完。 */
    private static void onFx(Runnable r) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        Platform.runLater(() -> {
            try {
                r.run();
            } finally {
                done.countDown();
            }
        });
        done.await(15, TimeUnit.SECONDS);
    }

    private static void run(Song song, String url, List<Song> songs) throws Exception {
        Media[] mediaHolder = new Media[1];
        MediaPlayer[] playerHolder = new MediaPlayer[1];
        String[] mediaError = {null};

        onFx(() -> {
            Media m = new Media(url);
            m.setOnError(() -> mediaError[0] = m.getError() == null
                    ? "?" : String.valueOf(m.getError().getMessage()));
            MediaPlayer p = new MediaPlayer(m);
            p.setVolume(0);
            p.setOnError(() -> {
                });
            mediaHolder[0] = m;
            playerHolder[0] = p;
        });
        Media media = mediaHolder[0];
        MediaPlayer player = playerHolder[0];
        if (player == null) {
            check("MediaPlayer 创建成功", false, "creation failed");
            return;
        }

        CountDownLatch ready = new CountDownLatch(1);
        onFx(() -> {
            player.setOnReady(ready::countDown);
            player.play();
        });
        boolean gotReady = ready.await(40, TimeUnit.SECONDS);
        check("Media 就绪（直链可解）", gotReady,
                gotReady ? "ok" : "timeout, mediaError=" + mediaError[0]);
        if (!gotReady) {
            return;
        }

        double dur = media.getDuration().toSeconds();
        check("时长可读且 > 0", dur > 0 && !Double.isNaN(dur), String.format("%.1fs", dur));

        double t0 = player.getCurrentTime().toSeconds();
        Thread.sleep(3000);
        double t1 = player.getCurrentTime().toSeconds();
        check("currentTime 在推进（进度条不是死的）", t1 > t0,
                String.format("%.2fs -> %.2fs", t0, t1));

        double half = dur / 2;
        onFx(() -> player.seek(javafx.util.Duration.seconds(half)));
        Thread.sleep(1500);
        double t2 = player.getCurrentTime().toSeconds();
        check("seek 到 50% 生效", Math.abs(t2 - half) < 8.0,
                String.format("目标 %.1fs，实际 %.1fs", half, t2));

        PlayQueue queue = new PlayQueue();
        queue.replaceAll(songs);
        int before = queue.currentIndex();
        CountDownLatch ended = new CountDownLatch(1);
        onFx(() -> {
            player.setOnEndOfMedia(ended::countDown);
            player.seek(javafx.util.Duration.seconds(Math.max(0, dur - 0.8)));
        });
        boolean fired = ended.await(30, TimeUnit.SECONDS);
        check("播完触发 onEndOfMedia", fired, fired ? "fired" : "timeout");

        Song next = queue.next();
        check("队列随之前进到下一首", queue.currentIndex() != before && next != null,
                String.format("index %d -> %d, next=%s", before, queue.currentIndex(),
                        next == null ? "null" : next.getTitle()));

        onFx(player::dispose);
    }

    /**
     * 绕开 JavaFX，用 JDK 自带 HttpClient 直接打这个直链。
     * <p>用来把「链接本身是坏的」和「JavaFX 处理不了」区分开。
     */
    private static void probeLink(String url) {
        try {
            HttpClient c = HttpClient.newBuilder()
                    .proxy(HttpClient.Builder.NO_PROXY)
                    .connectTimeout(java.time.Duration.ofSeconds(10))
                    .build();
            for (boolean range : new boolean[]{true, false}) {
                HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).GET();
                if (range) {
                    b = b.header("Range", "bytes=0-4095");
                }
                HttpResponse<byte[]> rs = c.send(b.build(), HttpResponse.BodyHandlers.ofByteArray());
                byte[] body = rs.body();
                String head = body.length >= 2
                        ? String.format("%02X %02X", body[0] & 0xFF, body[1] & 0xFF) : "(empty)";
                System.out.printf("raw http%s: status=%d bytes=%d head=%s accept-ranges=%s%n",
                        range ? " [Range]" : " [no Range]", rs.statusCode(), body.length, head,
                        rs.headers().firstValue("accept-ranges").orElse("-"));
            }
        } catch (Exception e) {
            System.out.println("raw http: FAILED " + e);
        }
    }

    private static String env(String k) {
        String v = System.getenv(k);
        return (v == null || v.isBlank()) ? null : v;
    }

    private static void check(String name, boolean ok, String detail) {
        System.out.printf("%-40s %s  (%s)%n", name, ok ? "PASS" : "FAIL", detail);
        if (!ok) {
            failures++;
        }
    }
}