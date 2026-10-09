package com.jello.music;

import com.jello.music.api.KuGouApiClient;
import com.jello.music.api.Playlist;
import com.jello.music.model.KuGouCredentials;
import com.jello.music.model.Song;
import com.jello.music.player.PlayQueue;
import com.jello.music.player.SpectrumFeed;
import com.jello.music.ui.Assets;
import com.jello.music.ui.EdgeDock;
import com.jello.music.ui.ElasticReveal;
import com.jello.music.ui.PlayerPanel;
import com.jello.music.ui.PlaylistPanel;
import com.jello.music.ui.SpectrumView;
import com.jello.music.ui.Theme;
import javafx.animation.AnimationTimer;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.canvas.Canvas;
import javafx.scene.control.Label;
import javafx.scene.image.ImageView;
import javafx.scene.layout.Pane;
import javafx.scene.layout.StackPane;
import javafx.scene.media.Media;
import javafx.scene.media.MediaPlayer;
import javafx.scene.paint.Color;
import javafx.stage.Stage;
import javafx.stage.StageStyle;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Jello Music Java 版入口 —— 严格按原 Vue 版 {@code SigmaUI.vue} + {@code SigmaMusicPlayer.vue}
 * 的 800x600 绝对定位布局 1:1 复刻。
 *
 * <p><b>核心设计</b>：播放与频谱是两条互不阻塞的路径——
 * {@link MediaPlayer} 出声，{@link SpectrumFeed}（后台线程 + JLayer + FFT）画频谱。
 * JavaFX 的 MediaPlayer 不吐 PCM，拿不到频谱数据，这是 Java 侧必须自己解决的部分。
 *
 * <p><b>快捷键</b>：Shift+R 收起/展开（全局热键待接入）。
 */
public class MainApp extends Application {

    private static final int FFT_SIZE = 2048;
    private static final int BAND_COUNT = 48;
    private static final ExecutorService IO = Executors.newFixedThreadPool(3);

    private MediaPlayer player;
    private SpectrumFeed feed;
    private SpectrumView spectrumView;
    private PlayerPanel playerPanel;
    private PlaylistPanel playlistPanel;
    private Label statusLabel;
    private EdgeDock dock;
    private ElasticReveal reveal;

    private final PlayQueue queue = new PlayQueue();
    private final AtomicInteger requestSeq = new AtomicInteger();
    private KuGouApiClient api;
    private List<Playlist> playlists = List.of();
    private String currentDirectUrl;

    @Override
    public void start(Stage stage) {
        // 预热字体，避免首帧字体回退导致排版跳动
        Assets.light(14);

        api = new KuGouApiClient(credentials());

        stage.initStyle(StageStyle.TRANSPARENT);
        stage.setTitle("Jello Music");
        stage.setWidth(Theme.PANEL_W);
        stage.setHeight(Theme.PANEL_H);

        // ---- 主面板：绝对定位，与原版一致 ----
        Pane root = new Pane();

        playerPanel = new PlayerPanel();
        playerPanel.onPrev(() -> playCurrent(queue.previous()));
        playerPanel.onNext(() -> playCurrent(queue.next()));
        playerPanel.onPlayToggle(this::togglePlay);
        root.getChildren().add(playerPanel);

        // ---- 左栏歌单：显示歌单条目 ----
        playlistPanel = new PlaylistPanel(Theme.PLAYLIST_W, Theme.PLAYLIST_H, this::onPlaylistSelect);
        playlistPanel.setLayoutX(Theme.PLAYLIST_X);
        playlistPanel.setLayoutY(Theme.PLAYLIST_Y);
        root.getChildren().add(playlistPanel);

        // ---- 频谱：原版没有独立频谱窗，这里画在左栏底部（原版频谱按钮位置）----
        feed = new SpectrumFeed(null, FFT_SIZE, BAND_COUNT, 60);
        spectrumView = new SpectrumView(feed, BAND_COUNT, 220, 60);
        spectrumCanvasHolder = spectrumView.canvas();
        // Canvas 是固定尺寸节点，但放进 Pane 时必须显式给 prefSize 与 layoutX/Y，
        // 否则宽高会是 -1（未布局），整块频谱画不出来。
        spectrumCanvasHolder.setLayoutX(15);
        spectrumCanvasHolder.setLayoutY(452);
        root.getChildren().add(spectrumCanvasHolder);
        spectrumView.start();

        // ---- 状态：放在左下角，不与原版元素冲突 ----
        statusLabel = new Label("加载中…");
        statusLabel.setFont(Assets.light(11));
        statusLabel.setTextFill(Theme.TEXT_DIM);
        statusLabel.setLayoutX(8);
        statusLabel.setLayoutY(576);
        statusLabel.setPrefWidth(240);
        root.getChildren().add(statusLabel);

        StackPane overlay = new StackPane(root);
        reveal = new ElasticReveal(overlay);

        Scene scene = new Scene(overlay, Theme.PANEL_W, Theme.PANEL_H);
        scene.setFill(Color.TRANSPARENT);
        scene.setOnKeyPressed(e -> {
            if (e.getCode() == javafx.scene.input.KeyCode.R && e.isShiftDown()) {
                toggleDock();
            }
        });
        stage.setScene(scene);
        stage.setAlwaysOnTop(true);

        dock = new EdgeDock(stage);
        installDragHandlers(root);
        dock.expand();
        reveal.expand(null);
        stage.show();

        queue.addListener(song -> Platform.runLater(() -> onQueueCurrentChanged(song)));
        loadPlaylists();
    }

    // ---- 歌单 / 队列 ----

    private void loadPlaylists() {
        status("加载歌单…");
        int seq = requestSeq.incrementAndGet();
        IO.execute(() -> {
            try {
                List<Playlist> pls = api.userPlaylists(1, 20);
                pls.sort((a, b) -> b.count() - a.count());
                // 左栏显示非空歌单
                List<Playlist> nonEmpty = pls.stream().filter(p -> p.count() > 0).toList();
                Platform.runLater(() -> {
                    if (seq != requestSeq.get()) {
                        return;
                    }
                    playlists = pls;
                    playlistPanel.setItems(nonEmpty.stream()
                            .map(com.jello.music.api.Playlist::name).toList());
                    // 自动载入第一个非空歌单的歌曲到队列
                    if (!nonEmpty.isEmpty()) {
                        loadTracks(nonEmpty.get(0), seq);
                    } else {
                        status("没有非空歌单");
                    }
                });
            } catch (Exception e) {
                Platform.runLater(() -> status("加载歌单失败: " + e.getMessage()));
            }
        });
    }

    private void loadTracks(Playlist pl, int seq) {
        IO.execute(() -> {
            try {
                List<Song> songs = api.playlistTracks(pl.id(), 1, 50);
                Platform.runLater(() -> {
                    if (seq != requestSeq.get()) {
                        return;
                    }
                    queue.replaceAll(songs);
                    status(pl.name() + " · " + songs.size() + " 首");
                    if (!songs.isEmpty()) {
                        playCurrent(songs.get(0));
                    }
                });
            } catch (Exception e) {
                Platform.runLater(() -> status("加载歌曲失败: " + e.getMessage()));
            }
        });
    }

    private void onPlaylistSelect(int index) {
        List<Playlist> nonEmpty = playlists.stream().filter(p -> p.count() > 0).toList();
        if (index >= 0 && index < nonEmpty.size()) {
            loadTracks(nonEmpty.get(index), requestSeq.incrementAndGet());
        }
    }

    private void playCurrent(Song song) {
        if (song == null) {
            return;
        }
        playerPanel.setSong(song.getTitle(), song.getArtist(), song.getCoverUrl());
        playerPanel.setCover(song.getCoverUrl());
        status("加载直链: " + song.titleWithArtist());
        int seq = requestSeq.incrementAndGet();

        IO.execute(() -> {
            try {
                String url = api.songUrl(song.getHash(), 320);
                Platform.runLater(() -> {
                    if (seq != requestSeq.get()) {
                        return;
                    }
                    currentDirectUrl = url;
                    startPlayback(url);
                });
            } catch (Exception e) {
                Platform.runLater(() -> status("取直链失败: " + e.getMessage()));
            }
        });
    }

    private void onQueueCurrentChanged(Song song) {
        if (song != null) {
            playerPanel.setSong(song.getTitle(), song.getArtist(), song.getCoverUrl());
            playerPanel.setCover(song.getCoverUrl());
        }
    }

    // ---- 播放 / 频谱 ----

    private void startPlayback(String url) {
        disposePlayer();
        try {
            Media media = new Media(url);
            player = new MediaPlayer(media);
            player.setOnReady(() -> status("就绪"));
            player.setOnError(() -> status("播放失败（MediaPlayer 不支持 FLAC）"));
            player.setVolume(0.8);
            player.play();
            playerPanel.bindPlayer(player);
            rewireSpectrum(url);
        } catch (Exception e) {
            status("初始化播放失败：" + e.getMessage());
        }
    }

    private void rewireSpectrum(String url) {
        if (feed != null) {
            feed.close();
        }
        feed = new SpectrumFeed(url, FFT_SIZE, BAND_COUNT, 60);
        spectrumView.stop();
        spectrumView = new SpectrumView(feed, BAND_COUNT, 220, 60);
        // 替换旧 canvas
        Pane parent = (Pane) spectrumCanvasHolder.getParent();
        int idx = parent.getChildren().indexOf(spectrumCanvasHolder);
        if (idx >= 0) {
            parent.getChildren().set(idx, spectrumView.canvas());
            spectrumCanvasHolder = spectrumView.canvas();
            spectrumCanvasHolder.setLayoutX(15);
            spectrumCanvasHolder.setLayoutY(452);
        }
        spectrumView.start();

        new AnimationTimer() {
            @Override
            public void handle(long now) {
                if (feed == null || player == null) {
                    return;
                }
                if (feed.error() != null) {
                    status("频谱不可用");
                } else if (player.getStatus() == MediaPlayer.Status.PLAYING
                        && feed.sampleRate() > 0) {
                    status(String.format("播放中 · %d Hz", feed.sampleRate()));
                }
            }
        }.start();
    }

    private Canvas spectrumCanvasHolder;



    private void togglePlay() {
        if (player == null) {
            return;
        }
        if (player.getStatus() == MediaPlayer.Status.PLAYING) {
            player.pause();
        } else {
            player.play();
        }
    }

    private void disposePlayer() {
        if (player != null) {
            player.dispose();
            player = null;
        }
    }

    private void installDragHandlers(javafx.scene.Node overlay) {
        overlay.setOnMousePressed(e -> {
            if (!dock.isDocked()) {
                dock.beginDrag(e);
            }
        });
        overlay.setOnMouseDragged(e -> dock.drag(e));
        overlay.setOnMouseReleased(e -> dock.endDrag());
    }

    private void toggleDock() {
        if (dock.isDocked()) {
            dock.expand();
            reveal.expand(null);
        } else {
            reveal.collapse(() -> dock.collapse());
        }
    }

    private KuGouCredentials credentials() {
        KuGouCredentials cred = new KuGouCredentials();
        cred.setToken(env("JELLO_TOKEN"));
        cred.setUserid(env("JELLO_USERID"));
        cred.setDfid(env("JELLO_DFID"));
        return cred;
    }

    private static String env(String k) {
        String v = System.getenv(k);
        return (v == null || v.isBlank()) ? null : v;
    }

    private void status(String text) {
        if (statusLabel != null) {
            Platform.runLater(() -> statusLabel.setText(text));
        }
    }

    @Override
    public void stop() {
        if (spectrumView != null) {
            spectrumView.stop();
        }
        if (feed != null) {
            feed.close();
        }
        disposePlayer();
    }

    public static void main(String[] args) {
        launch(args);
    }
}