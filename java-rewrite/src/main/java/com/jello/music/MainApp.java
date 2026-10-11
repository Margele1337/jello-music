package com.jello.music;

import com.jello.music.api.KuGouApiClient;
import com.jello.music.api.Playlist;
import com.jello.music.api.PlaylistTab;
import com.jello.music.model.KuGouCredentials;
import com.jello.music.model.ResultCard;
import com.jello.music.model.Song;
import com.jello.music.player.PlayQueue;
import com.jello.music.player.SpectrumFeed;
import com.jello.music.system.RightShiftPoller;
import com.jello.music.ui.Assets;
import com.jello.music.ui.DragGate;
import com.jello.music.ui.EdgeDock;
import com.jello.music.ui.ElasticReveal;
import com.jello.music.ui.LoginView;
import com.jello.music.ui.OnboardingView;
import com.jello.music.ui.PlayerPanel;
import com.jello.music.ui.PlaylistPanel;
import com.jello.music.ui.RepeatButton;
import com.jello.music.ui.SpectrumView;
import com.jello.music.ui.Theme;
import javafx.animation.AnimationTimer;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.geometry.Pos;
import javafx.geometry.Rectangle2D;
import javafx.scene.Scene;
import javafx.scene.image.ImageView;
import javafx.scene.layout.Pane;
import javafx.scene.layout.StackPane;
import javafx.scene.media.Media;
import javafx.scene.media.MediaPlayer;
import javafx.scene.paint.Color;
import javafx.stage.Screen;
import javafx.stage.Stage;
import javafx.stage.StageStyle;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
 * <p><b>快捷键</b>：全局右 Shift 收起/展开。原版 Electron 走
 * {@code globalKeyService.js} 的 Windows 分支（每 8ms 轮询 {@code GetAsyncKeyState(0xA1)}），
 * Java 侧由 {@link RightShiftPoller} 1:1 复刻。取不到原生热键时（非 Windows / JNA 加载失败）
 * 退回窗口内的 Shift+R。
 */
public class MainApp extends Application {

    private static final int FFT_SIZE = 2048;
private static final int BAND_COUNT = 48;
    /** 原版 SigmaSearchBox 的 DAILY_TARGET_COUNT：每日推荐目标首数。 */
    private static final int DAILY_TARGET_COUNT = 60;
    private static final ExecutorService IO = Executors.newFixedThreadPool(3);

    private MediaPlayer player;
    private SpectrumFeed feed;
    private SpectrumView spectrumView;
    private PlayerPanel playerPanel;
    private PlaylistPanel playlistPanel;
private EdgeDock dock;
    private ElasticReveal reveal;
    private RightShiftPoller rshift;

    /** 视图容器：原版 SigmaUI.vue 的 sigma-shell，按 view 切换子视图。 */
    private final StackPane stageHolder = new StackPane();
    private StackPane playerView;
    private OnboardingView onboarding;
    private LoginView login;
    /**
     * 教程独占的���屏窗口。点「完成」之前 Sigma 主窗口不显示。
     *
     * <p>原版（Electron）是 800x600 面板内的一个视图，但 mod 那边
     * {@code KeyboardScreen} 是铺满整个游戏窗口的一整页——挤在 800x600 里键盘要
     * 缩到 0.649 才能塞下，全屏下则按 1:1 原尺寸显示。两者都留着，按 mod 的做法来。
     */
    private Stage onboardingStage;

    /** Sigma 主窗口（800x600）。教程阶段不显示，点「完成」后才 show()。 */
    private Stage sigmaStage;
    /** 登录态：启动时从 AppPrefs 读回，没有就走环境变量凭据。 */
    private final KuGouCredentials credentials = new KuGouCredentials();
    private com.jello.music.model.UserInfo userInfo;

    /**
     * 当前音量 0..1。原版音量是跨歌保持的（{@code volumePercent} 存在播放器里），
     * 而 Java 侧每首歌会重建一个 MediaPlayer，所以得自己存着。
     * 初值 1.0 对齐原版 SigmaVolumeSlider 的 default: 1。
     */
    private double volume = 1.0;

    private final PlayQueue queue = new PlayQueue();
    private final AtomicInteger requestSeq = new AtomicInteger();
    private KuGouApiClient api;
    private List<PlaylistTab> tabs = List.of();
    private String currentDirectUrl;

@Override
    public void start(Stage stage) {
        // start(Stage) 的参数只在 start() 可见，但教程结束时要在这里之外把窗口显示出来
        sigmaStage = stage;
        // 预热字体，避免首帧字体回退导致排版跳动
        Assets.light(14);

        initCredentials();
        api = new KuGouApiClient(credentials);

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
        playerPanel.onMediaEnd(() -> playCurrent(queue.next()));
        playerPanel.onSeek(this::seekTo);
        root.getChildren().add(playerPanel);

        // ---- 左栏歌单：显示歌单条目 ----
        playlistPanel = new PlaylistPanel(Theme.PLAYLIST_W, Theme.PLAYLIST_H, this::onPlaylistSelect);
        playlistPanel.setLayoutX(Theme.PLAYLIST_X);
        playlistPanel.setLayoutY(Theme.PLAYLIST_Y);
        root.getChildren().add(playlistPanel);

        // ---- 频谱：原版是独立的桌面悬浮窗（SigmaSpectrumHUD），不占左栏 ----
        // 之前把 Canvas 直接塞在左栏 (15,452)，结果盖住了 (68,430) 的 114x114 专辑封面，
        // 和 1:1 布局冲突。这里改成独立透明窗，由左下角 40x40 频谱按钮开关。
        feed = new SpectrumFeed(null, FFT_SIZE, BAND_COUNT, 60);
        spectrumView = new SpectrumView(feed, BAND_COUNT, 220, 60);
        buildSpectrumStage(stage);
        spectrumView.start();
        playerPanel.onSpectrumToggle(this::toggleSpectrumWindow);
// 四态：0 随机 / 1 列表循环 / 2 单曲循环 / 3 顺序（顺序 PlayMode.js:4-9，默认 1）
        playerPanel.onRepeatToggle(this::applyPlaybackMode);
        // 原版存在 localStorage['player_playback_mode']，重启后还是上次的模式
        applyPlaybackMode(AppPrefs.playbackMode());
        playerPanel.onDockTrigger(this::expandDock);
        // 记住用户拖出来的音量：换歌会重建 MediaPlayer，音量得自己带着走
        playerPanel.onVolumeChanged(v -> volume = v);
        playerPanel.searchBox().onSubmit(this::runSearch);
        // 点歌曲卡：用「当前网格里的整列」替换队列再播放这首，
        // 这样下一首/上一首走的是同一批（对应原版 playSongList(songs, hash)）
        playerPanel.searchBox().onPick(song -> {
            queue.replaceAll(songsOfVisibleCards());
            playCurrent(song);
        });
        // 点歌单卡：下钻到该歌单的曲目列表
        playerPanel.searchBox().onOpenPlaylist(this::showPlaylistTracks);

        // ---- 状态 ----
        // 原版右栏除搜索框外没有任何文字，之前挂过一个 Label 当状态提示，
        // 结果「加载歌单失败: null」直接压在搜索框上方，1:1 做不到。
        // 现在只写 stderr（run.bat / jpackage 的控制台能看到），不占面板像素。
        status("加载中…");

StackPane overlay = new StackPane(root);
        overlay.setId("sigma-player");
        playerView = overlay;
        reveal = new ElasticReveal(overlay);
        stageHolder.getChildren().add(overlay);

        // ---- 视图切换（原版 SigmaUI.vue 的 view 状态）----
        // 顺序与原版一致：没跑过教程先进教程，跑过但没登录态才进登录页（SigmaUI.vue:174-179）
        if (AppPrefs.shouldShowOnboarding()) {
            Rectangle2D bounds = Screen.getScreens().get(0).getVisualBounds();
            // 必须用全屏尺寸构造：OnboardingView 会 setClip(一个固定尺寸的矩形)，
            // 传 800x600 的话整页会被裁成左上角一小块（键盘按全屏算出居中位置后
            // 被裁掉大半，就是上一版截图里那个样子）。
            onboarding = new OnboardingView(bounds.getWidth(), bounds.getHeight());
            onboarding.setId("sigma-onboarding");
            onboarding.onKeySelect(code -> status("选中按键 " + code));
            onboarding.onFinish(this::completeOnboarding);
            buildOnboardingStage(bounds);
            // 教程要教用户「按右 Shift 呼出」，此时热键必须挂起：
            // 否则用户跟着教程按 Shift，窗口当场就收起来了。
            // 对应原版 SigmaUI 切到 onboarding 时发的 sigma-hotkey-suspend。
            // 注意此刻 rshift 还没建（建在 Scene 之后），所以统一交给 syncHotkeySuspend()
            syncHotkeySuspend();
        }

        Scene scene = new Scene(stageHolder, Theme.PANEL_W, Theme.PANEL_H);
        scene.setFill(Color.TRANSPARENT);
        // 全局右 Shift 收起/展开。回调在轮询线程上，必须切回 FX 线程。
rshift = RightShiftPoller.createNative(() -> Platform.runLater(this::toggleDock));
        // 建完之后再对一次：教程是在 rshift 之前挂上去的
        syncHotkeySuspend();
        if (rshift == null) {
            // 拿不到原生热键才退回窗口内快捷键；两者同时存在会一次按键触发两次
            // （先收起又立刻展开，等于没反应）。
            scene.setOnKeyPressed(e -> {
                if (e.getCode() == javafx.scene.input.KeyCode.R && e.isShiftDown()) {
                    toggleDock();
                }
            });
        }
        stage.setScene(scene);
        stage.setAlwaysOnTop(true);

dock = new EdgeDock(stage);
        installDragHandlers(root);
        dock.expand();
        reveal.expand(null);

        // 教程开着的话，Sigma 窗口先不显示；等用户点「完成」再显示。
        if (onboardingStage != null) {
            onboardingStage.show();
            clampToPrimaryScreen(onboardingStage);
            // 视图要等 CSS 跑过才知道文字的真实宽度，缩放后再摆一次
            onboarding.layout(onboardingStage.getWidth(), onboardingStage.getHeight());
        } else {
            showSigmaStage();
        }

        // listener 由 PlayQueue.fire() 同步触发，而 fire() 可能发生在任意线程。
        // 因此这里做一次线程判断：已在 FX 线程就直接更新，否则切过去。
        // 注意不能无脑 runLater —— replaceAll 是在 FX 线程里被调用的，
        // 再嵌套提交会让时序变得难以追踪（排查这个 bug 时被坑过）。
        queue.addListener(song -> {
            if (Platform.isFxApplicationThread()) {
                onQueueCurrentChanged(song);
            } else {
                Platform.runLater(() -> onQueueCurrentChanged(song));
            }
        });
        loadPlaylists();
    }

    // ---- 视图切换 ----

    /**
     * 给教程开一个铺满主屏幕的无边框窗口。
     *
     * <p>对应 mod 的 {@code KeyboardScreen}：单独一页，不是主面板里的一个视图。
     * Sigma 窗口此时还没显示，用户在教程里看到的就只有这一页。
     */
    private void buildOnboardingStage(Rectangle2D bounds) {
        Stage tut = new Stage();
        tut.initStyle(StageStyle.UNDECORATED);
        tut.setTitle("Jello Music");
        Scene tutScene = new Scene(onboarding, bounds.getWidth(), bounds.getHeight());
        // Scene 默认是白色填充。OnboardingView 自己那层 rgba(1,1,1,0.25) 是给
        // 透明主窗口叠在桌面上用的，单独开窗就得先垫一层不透明的深色底，
        // 否则 25% 黑压白底 = 浅灰，标题全糊。底色沿用登录页的 #101114。
        tutScene.setFill(Color.color(16 / 255.0, 17 / 255.0, 20 / 255.0));
        tut.setScene(tutScene);
        tut.setX(bounds.getMinX());
        tut.setY(bounds.getMinY());
        tut.setAlwaysOnTop(true);
        // Alt+F4 直接走「教程结束」，别让用户把自己关到没有窗口可看
        tut.setOnCloseRequest(e -> completeOnboarding());
        // 屏幕变了（拔显示器 / 改分辨率）要跟着重排，否则又会被裁掉一块
        tut.widthProperty().addListener((o, was, now) ->
                onboarding.layout(now.doubleValue(), tut.getHeight()));
        tut.heightProperty().addListener((o, was, now) ->
                onboarding.layout(tut.getWidth(), now.doubleValue()));
        onboardingStage = tut;
    }

    /** 教程结束：记下完成状态、关掉教程窗，再把 Sigma 窗口显示出来。 */
    private void completeOnboarding() {
        AppPrefs.setOnboardingDone();
        closeOnboardingStage();
        showSigmaStage();
    }

    private void closeOnboardingStage() {
        if (onboardingStage != null) {
            Stage old = onboardingStage;
            onboardingStage = null;
            old.close();
        }
        if (onboarding != null) {
            onboarding = null;
            // 热键只在教程期间挂起；教程一关必须恢复，否则右键 Shift 永远失效。
            syncHotkeySuspend();
        }
    }

    /** 显示 Sigma 主窗口并按登录态分流。 */
    private void showSigmaStage() {
        if (!sigmaStage.isShowing()) {
            sigmaStage.show();
            clampToPrimaryScreen(sigmaStage);
        }
        afterOnboarding();
    }

    /** 教程结束（或本来就不用教程）后的分流：有登录态回主界面，没有就去登录页。 */
    private void afterOnboarding() {
        if (userInfo != null && userInfo.isAuthenticated()) {
            switchToPlayer();
        } else {
            switchToLogin();
        }
    }

    /** 回主界面（对应 SigmaUI.vue 的 {@code view = 'player'}）。 */
    private void switchToPlayer() {
        closeOnboardingStage();
        if (login != null) {
            login.dispose();
            login.setVisible(false);
            stageHolder.getChildren().remove(login);
            login = null;
        }
        if (playerView != null) {
            playerView.setVisible(true);
        }
        syncHotkeySuspend();
    }

    /** 去登录页（对应 {@code view = 'login'}）。 */
    private void switchToLogin() {
        closeOnboardingStage();
        if (login == null) {
            login = new LoginView(api);
            login.setId("sigma-login");
            login.onSuccess(this::onLoginSuccess);
            login.onBack(this::switchToPlayer);
            stageHolder.getChildren().add(login);
        }
        login.setVisible(true);
        if (playerView != null) {
            playerView.setVisible(false);
        }
        syncHotkeySuspend();
    }

    /**
     * 登录成功：把登录态写进请求凭据 + 持久化，然后回主界面并重拉歌单。
     *
     * <p>原版是 {@code MoeAuth.setData({UserInfo})} 之后 watcher 切回 player
     * 并发 {@code auth-changed}；这里等价地把 UserInfo 灌进 {@link KuGouCredentials}。
     */
    private void onLoginSuccess(com.jello.music.model.UserInfo user) {
        userInfo = user;
        user.applyTo(credentials);
        AppPrefs.saveUser(user);
        status("登录成功: " + user.getNickname() + " (" + user.getUserid() + ")");
        switchToPlayer();
        loadPlaylists();
    }

    /**
     * 教程视图期间挂起右 Shift 热键。
     *
     * <p>原版 {@code SigmaUI} 在 {@code view === 'onboarding'} 时发
     * {@code sigma-hotkey-suspend}，主进程调 {@code setGlobalKeySuspended(true)}——
     * 教程第一页就是教「按右 Shift 呼出」，不挂起的话用户一按窗口就没了。
     */
    private void syncHotkeySuspend() {
        if (rshift != null) {
            rshift.setSuspended(onboarding != null);
        }
    }

    // ---- 歌单 / 队列 ----

    /**
     * 左栏固定先把「猜你喜欢 / 每日推荐」两项摆上去，再异步补我的歌单。
     *
     * <p>这样即使 api 没起来或很慢，左栏也不会是空白的——原版是先摆固定项、
     * 再 await 拉歌单，行为一致。
     */
    private void loadPlaylists() {
        status("加载歌单…");
        tabs = List.of(new PlaylistTab(PlaylistTab.GUESS, "猜你喜欢", null),
                new PlaylistTab(PlaylistTab.DAILY, "每日推荐", null));
        playlistPanel.setItems(tabs.stream().map(PlaylistTab::name).toList());

        IO.execute(() -> {
            try {
                List<Playlist> raw = api.userPlaylists(1, 500);
                // 原版 SigmaPlaylistPanel.load：sort 升序 + 只留「我喜欢」与自己的歌单，
                // 「我喜欢」永远排在自定义歌单最前
                List<PlaylistTab> built = KuGouApiClient.playlistTabs(raw,
                        credentials.getUserid());
                Platform.runLater(() -> {
                    tabs = built;
                    playlistPanel.setItems(built.stream().map(PlaylistTab::name).toList());
                });
            } catch (Exception e) {
                status("加载歌单失败 -> " + describe(e));
            }
        });
    }

    /** 左栏选中：猜你喜欢直接播、每日推荐与歌单铺到右栏网格。 */
    private void onPlaylistSelect(int index) {
        if (index < 0 || index >= tabs.size()) {
            return;
        }
        PlaylistTab tab = tabs.get(index);
        if (tab.isGuess()) {
            playGuessYouLike();
        } else if (tab.isDaily()) {
            loadDailyRecommend();
        } else if (tab.gid() != null) {
            showPlaylistTracks(tab.gid());
        }
    }

    /**
     * 猜你喜欢（{@code /top/card?card_id=1}）：打乱后直接进队列播放，右栏保持空白。
     * 顺序随机是原版的做法——每次点都是不一样的第一首。
     */
    private void playGuessYouLike() {
        playerPanel.searchBox().clear();
        status("加载猜你喜欢…");
        IO.execute(() -> {
            try {
                List<Song> songs = api.topCard(1);
                if (songs.isEmpty()) {
                    return;
                }
                Collections.shuffle(songs);
                Platform.runLater(() -> {
                    queue.replaceAll(songs);
                    Song first = songs.get(0);
                    playerPanel.setSong(first.getTitle(), first.getArtist(), first.getCoverUrl());
                    playerPanel.setCover(first.getCoverUrl());
                    playCurrent(first);
                });
            } catch (Exception e) {
                Platform.runLater(() -> status("猜你喜欢加载失败 -> " + describe(e)));
            }
        });
    }

    /**
     * 每日推荐。
     *
     * <p>普通账号服务端默认只给 30 首（会员 60），所以按 pagesize=60 翻两页拉，
     * 还不够就用「猜你喜欢」按 hash 去重补足——与原版 {@code loadDailyRecommend} 同一套逻辑。
     */
    private void loadDailyRecommend() {
        playerPanel.searchBox().clear();
        status("加载每日推荐…");
        IO.execute(() -> {
            try {
                List<Song> collected = new ArrayList<>();
                Set<String> seen = new HashSet<>();
                for (int page : new int[]{1, 2}) {
                    List<Song> list;
                    try {
                        list = api.everydayRecommend(page, DAILY_TARGET_COUNT);
                    } catch (Exception e) {
                        break;
                    }
                    if (list.isEmpty()) {
                        break;
                    }
                    int before = collected.size();
                    for (Song s : list) {
                        if (s.getHash().isEmpty() || !seen.add(s.getHash())) {
                            continue;
                        }
                        collected.add(s);
                    }
                    if (collected.size() >= DAILY_TARGET_COUNT) {
                        break;
                    }
                    // 一首没新增 = 服务端不支持翻页，再翻也是同一批
                    if (collected.size() == before) {
                        break;
                    }
                }
                if (collected.size() < DAILY_TARGET_COUNT) {
                    try {
                        for (Song s : api.topCard(1)) {
                            if (collected.size() >= DAILY_TARGET_COUNT) {
                                break;
                            }
                            if (s.getHash().isEmpty() || !seen.add(s.getHash())) {
                                continue;
                            }
                            collected.add(s);
                        }
                    } catch (Exception ignored) {
                        // 补足失败就用已取到的部分
                    }
                }
                List<Song> result = collected;
                Platform.runLater(() -> {
                    playerPanel.searchBox().showResults(toCards(result));
                    status("每日推荐 " + result.size() + " 首");
                });
            } catch (Exception e) {
                Platform.runLater(() -> status("每日推荐加载失败 -> " + describe(e)));
            }
        });
    }

    /** 歌单曲目铺到右栏网格（点歌单卡或点左栏歌单都走这里）。 */
    private void showPlaylistTracks(String gid) {
        status("加载歌单…");
        IO.execute(() -> {
            try {
                List<Song> songs = api.playlistTracks(gid, 1, 500);
                Platform.runLater(() -> {
                    playerPanel.searchBox().showResults(toCards(songs));
                    status("歌单 " + songs.size() + " 首");
                });
            } catch (Exception e) {
                Platform.runLater(() -> status("加载歌曲失败 -> " + describe(e)));
            }
        });
    }

    private static List<ResultCard> toCards(List<Song> songs) {
        List<ResultCard> out = new ArrayList<>(songs.size());
        for (Song s : songs) {
            out.add(ResultCard.song(s.getHash(), s.getTitle(), s.getArtist(), s.getCoverUrl()));
        }
        return out;
    }

    /** 当前网格里的歌曲卡（歌单卡不是歌，跳过）。 */
    private List<Song> songsOfVisibleCards() {
        List<Song> out = new ArrayList<>();
        for (ResultCard c : playerPanel.searchBox().currentCards()) {
            if (!c.isPlaylist()) {
                out.add(c.toSong());
            }
        }
        return out;
    }

    /** 搜索：走 api 的 /search/complex，歌单卡在前、歌曲卡在后（对齐原版）。 */
    private void runSearch(String keyword) {
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            playerPanel.searchBox().clear();
            return;
        }
        status("搜索中…");
        IO.execute(() -> {
            try {
                KuGouApiClient.SearchResult res = api.search(kw);
                List<ResultCard> cards = new ArrayList<>(res.playlists());
                cards.addAll(toCards(res.songs()));
                Platform.runLater(() -> {
                    playerPanel.searchBox().showResults(cards);
                    status(cards.isEmpty() ? "没有找到结果"
                            : "找到 " + res.playlists().size() + " 个歌单 / "
                            + res.songs().size() + " 首");
                });
            } catch (Exception e) {
                Platform.runLater(() -> status("搜索失败 -> " + describe(e)));
            }
        });
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
                Platform.runLater(() -> status("取直链失败 -> " + describe(e)));
            }
        });
    }

    /** 进度条定位：fraction 是 0..1。 */
    private void seekTo(double fraction) {
        if (player == null || player.getMedia() == null) {
            return;
        }
        double dur = player.getMedia().getDuration().toSeconds();
        if (Double.isNaN(dur) || dur <= 0) {
            return;
        }
        // MediaPlayer.seek 收的是 javafx.util.Duration（不是 java.time.Duration），
        // 它的 seconds(double) 可以直接带小数，不用自己换算毫秒
        player.seek(javafx.util.Duration.seconds(dur * fraction));
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
            // 用记住的音量，不要写死：之前每首歌都 setVolume(0.8)，
            // 用户拖出来的音量下一首就被冲掉了。原版的 volumePercent 是保持的。
            player.setVolume(volume);
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
        // 换到悬浮窗里：替换掉旧 canvas，保持同一个 Scene/Stage
        if (spectrumStage != null) {
            Pane parent = (Pane) spectrumStage.getScene().getRoot();
            parent.getChildren().set(0, spectrumView.canvas());
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

    private Stage spectrumStage;

    /** 建一个透明、无边框、置顶的频谱悬浮窗，贴在主面板左下外侧。 */
    private void buildSpectrumStage(Stage main) {
        spectrumStage = new Stage();
        spectrumStage.initStyle(StageStyle.TRANSPARENT);
        spectrumStage.setTitle("Jello Spectrum");
        spectrumStage.setAlwaysOnTop(true);
        Pane holder = new Pane();
        holder.getChildren().add(spectrumView.canvas());
        Scene sc = new Scene(holder, 220, 60);
        sc.setFill(Color.TRANSPARENT);
        spectrumStage.setScene(sc);
        repositionSpectrum(main);
        spectrumStage.hide();
    }

    private void repositionSpectrum(Stage main) {
        if (spectrumStage == null) {
            return;
        }
        javafx.geometry.Rectangle2D area = javafx.stage.Screen.getPrimary().getVisualBounds();
        double x = main.getX() + 12;
        double y = main.getY() + Theme.PANEL_H - 72;
        spectrumStage.setX(Math.max(area.getMinX(), Math.min(x, area.getMaxX() - 220)));
        spectrumStage.setY(Math.max(area.getMinY(), Math.min(y, area.getMaxY() - 60)));
    }

    private void toggleSpectrumWindow() {
        if (spectrumStage == null) {
            return;
        }
        if (spectrumStage.isShowing()) {
            spectrumStage.hide();
            playerPanel.setSpectrumActive(false);
        } else {
            spectrumStage.show();
            playerPanel.setSpectrumActive(true);
        }
    }

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
            // 原版 SigmaMusicPlayer.vue:403 —— 只有左键起拖
            if (e.getButton() != javafx.scene.input.MouseButton.PRIMARY) {
                return;
            }
            // 原版 :405 target.closest(NO_DRAG_SELECTOR)：
            // 落在搜索框 / 按钮 / 滚动面板这些控件上时不要起拖，
            // 否则点一下按钮就变成拖窗了
            if (DragGate.blocked(e.getTarget())) {
                return;
            }
            if (!dock.isDocked()) {
                dock.beginDrag(e);
            }
        });
        overlay.setOnMouseDragged(e -> dock.drag(e));
        overlay.setOnMouseReleased(e -> dock.endDrag());
    }

    /** 播放模式索引（0..3）→ 队列语义，同时刷新按钮并落盘。 */
    private void applyPlaybackMode(int mode) {
        queue.setRepeat(modeToRepeat(mode));
        playerPanel.setRepeatState(mode);
        AppPrefs.setPlaybackMode(mode);
    }

    private static PlayQueue.Repeat modeToRepeat(int mode) {
        return switch (mode) {
            case RepeatButton.MODE_SHUFFLE -> PlayQueue.Repeat.SHUFFLE;
            case RepeatButton.MODE_ONE -> PlayQueue.Repeat.ONE;
            case RepeatButton.MODE_SEQUENTIAL -> PlayQueue.Repeat.NONE;
            default -> PlayQueue.Repeat.ALL;
        };
    }

    private void toggleDock() {
        if (dock.isDocked()) {
            expandDock();
        } else {
            reveal.collapse(() -> {
                dock.collapse();
                // 收起后窗口只剩右侧 40px 露在屏幕里，正好对应原版那条
                // 41px 的 .smp-dock-trigger（它取的是面板 x=0..41）。
                playerPanel.setDockTriggerActive(true);
            });
        }
    }

    private void expandDock() {
        dock.expand();
        reveal.expand(null);
        playerPanel.setDockTriggerActive(false);
    }

/**
     * 初始化登录态与凭据。
     *
     * <p>优先级：上次登录（AppPrefs，原版存 localStorage）> 环境变量。
     * 这样登录页登录过一次之后就不用每次手动设 {@code JELLO_*} 了。
     */
    private void initCredentials() {
        credentials.setDfid(env("JELLO_DFID"));
        userInfo = AppPrefs.loadUser();
        if (userInfo != null && userInfo.isAuthenticated()) {
            userInfo.applyTo(credentials);
        } else {
            userInfo = null;
            credentials.setToken(env("JELLO_TOKEN"));
            credentials.setUserid(env("JELLO_USERID"));
        }
    }

    private static String env(String k) {
        String v = System.getenv(k);
        return (v == null || v.isBlank()) ? null : v;
    }

    private void status(String text) {
        // 频谱那个 AnimationTimer 每帧都会喂状态进来，不去重会把控制台刷爆
        if (text.equals(lastStatus)) {
            return;
        }
        lastStatus = text;
        System.err.println("[Jello] " + text);
    }

    /**
     * 失败信息不能只打 {@code e.getMessage()}：{@code InterruptedException} 之类
     * 的 message 就是 null，界面上只会看到「加载歌单失败: null」，等于没报错。
     * 带上异常类名，并在 API 没起来时直接点出该开哪个命令。
     */
    private String describe(Throwable e) {
        String msg = e.getMessage();
        StringBuilder sb = new StringBuilder(e.getClass().getSimpleName());
        if (msg != null && !msg.isBlank()) {
            sb.append(": ").append(msg);
        }
        if (e instanceof java.net.ConnectException || e instanceof java.io.IOException) {
            sb.append("（本地 KuGou API 没起来？在仓库根目录执行 npm run api，端口 6521）");
        }
        return sb.toString();
    }

    private String lastStatus = "";

    @Override
public void stop() {
        if (onboardingStage != null) {
            onboardingStage.hide();
        }
        if (spectrumStage != null) {
            spectrumStage.hide();
        }
        if (spectrumView != null) {
            spectrumView.stop();
        }
        if (feed != null) {
            feed.close();
        }
        if (rshift != null) {
            rshift.close();
        }
        disposePlayer();
    }

    public static void main(String[] args) {
        launch(args);
    }

    /**
     * 把窗口钳制到主屏工作区内。
     * EdgeDock 摆位依赖主屏，接了多显示器、或刚拔掉副屏时可能算到一块已不存在的屏，
     * 窗口就被摆到屏幕外去了（进程还在、窗口却找不到，这个坑踩过）。摆位后再钳一次兜底。
     */
    private void clampToPrimaryScreen(Stage stage) {
        javafx.geometry.Rectangle2D area = javafx.stage.Screen.getScreens().stream()
                .filter(s -> s.getVisualBounds().intersects(1, 1, 1, 1))
                .findFirst()
                .orElse(javafx.stage.Screen.getPrimary())
                .getVisualBounds();
        stage.setX(Math.max(area.getMinX(),
                Math.min(stage.getX(), area.getMaxX() - stage.getWidth())));
        stage.setY(Math.max(area.getMinY(),
                Math.min(stage.getY(), area.getMaxY() - stage.getHeight())));
    }
}