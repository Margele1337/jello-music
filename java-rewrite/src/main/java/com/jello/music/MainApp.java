package com.jello.music;

import com.jello.music.api.KuGouApiClient;
import com.jello.music.api.Playlist;
import com.jello.music.api.PlaylistTab;
import com.jello.music.api.QualityResolver;
import com.jello.music.model.KuGouCredentials;
import com.jello.music.model.ResultCard;
import com.jello.music.model.Song;
import com.jello.music.player.PlayQueue;
import com.jello.music.player.SpectrumFeed;
import com.jello.music.system.AutoStart;
import com.jello.music.system.MousePassthrough;
import com.jello.music.system.SingleInstance;
import com.jello.music.system.RightShiftPoller;
import com.jello.music.system.TrayIconHelper;
import com.jello.music.system.UiScale;
import com.jello.music.ui.Assets;
import com.jello.music.ui.DragGate;
import com.jello.music.ui.EdgeDock;
import com.jello.music.ui.ElasticReveal;
import com.jello.music.ui.LoginView;
import com.jello.music.ui.OnboardingView;
import com.jello.music.ui.PlayerPanel;
import com.jello.music.ui.PlaylistPanel;
import com.jello.music.ui.RepeatButton;
import com.jello.music.ui.RightTitleBar;
import com.jello.music.ui.SettingsView;
import com.jello.music.ui.SpectrumInfoBlock;
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
import javafx.scene.shape.Rectangle;
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

    /**
     * 频谱常量取 sigmarebase {@code MusicManager.renderSpectrum}（:171-240）的定义。
     *
     * <p>关键点：<b>条高是绝对像素</b>，公式
     * {@code (sqrt(amplitudes)/12 - 5) * (窗口高/1080)}，
     * 与频谱窗自身高度无关——窗口只决定可见范围与余量。
     */
    private static final int FFT_SIZE = com.jello.music.player.SpectrumFeed.FFT_SIZE;
    private static final int BAND_COUNT = com.jello.music.player.SpectrumFeed.BAR_COUNT;

    /** 音画差补偿默认值，对应 Electron 侧 {@code SPECTRUM_AV_DELAY_DEFAULT_MS}。 */
    private static final double SPECTRUM_AV_DELAY_DEFAULT_MS = 590;

    /** 频谱窗开关，对应原版设置项 key {@code desktopSpectrum}。 */
    private static final String SPECTRUM_ON_KEY = "desktopSpectrum";

    /**
     * 频谱悬浮窗尺寸。
     *
     * <p>必须容得下左下角的信息块（100x100 封面 + 右侧歌名），
     * 否则封面会被裁掉。宽度取 114 条 × 3px = 342 再留信息块的余量。
     */
    private static final double SPECTRUM_W = 420;
    private static final double SPECTRUM_H = 130;

    /** 原版 SigmaSearchBox 的 DAILY_TARGET_COUNT：每日推荐目标首数。 */
    private static final int DAILY_TARGET_COUNT = 60;
    private static final ExecutorService IO = Executors.newFixedThreadPool(3);

    private MediaPlayer player;
    private SpectrumFeed feed;
    private SpectrumView spectrumView;
    private PlayerPanel playerPanel;
    private PlaylistPanel playlistPanel;
    private RightTitleBar rightTitleBar;
private EdgeDock dock;
    private ElasticReveal reveal;
    private RightShiftPoller rshift;

    /** 视图容器：原版 SigmaUI.vue 的 sigma-shell，按 view 切换子视图。 */
    private final StackPane stageHolder = new StackPane();
    private StackPane playerView;
    private OnboardingView onboarding;
    private LoginView login;
    private com.jello.music.ui.SettingsView settings;
    private TrayIconHelper tray;
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
    /** 上次接受的 RSHIFT 收起/展开时刻，用于 120ms 触发节流。 */
    private long lastToggleAt;

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

        // 开机自启：每次启动都按当前进程的实际入口重写一遍登录项。
        // 这样从 run.bat（开发）切到 pkgout（打包）时登录项不会指向失效路径。
        AutoStart.applyFromSettings();

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
        spectrumView = new SpectrumView(feed, BAND_COUNT, SPECTRUM_W, SPECTRUM_H);
        applySpectrumSettings(feed, spectrumView);
        buildSpectrumStage(stage);
        spectrumView.start();
        playerPanel.onSpectrumToggle(this::toggleSpectrumWindow);
// 四态：0 随机 / 1 列表循环 / 2 单曲循环 / 3 顺序（顺序 PlayMode.js:4-9，默认 1）
        playerPanel.onRepeatToggle(this::applyPlaybackMode);
        // 原版存在 localStorage['player_playback_mode']，重启后还是上次的模式
        applyPlaybackMode(AppPrefs.playbackMode());
        playerPanel.onDockTrigger(this::expandDock);
        setupTray();
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

        // ---- 右栏顶部模糊标题栏（sigmarebase MusicPlayer.method13196:474-533）----
        // 随右栏滚动淡入，标题用两套字交叉淡入。之前完全没有这块。
        rightTitleBar = new RightTitleBar();
        rightTitleBar.setPrefSize(Theme.RIGHT_PANEL_W, RightTitleBar.BAR_H);
        rightTitleBar.setLayoutX(Theme.LEFT_PANEL_W);
        rightTitleBar.setLayoutY(0);
        // 刷新淡入：右栏滚动位置只有它自己知道，所以在已有的状态刷新里同步
        rightTitleBar.setScroll(0);
        root.getChildren().add(rightTitleBar);

        // 标题淡入跟着右栏滚动走。权威是在 render 每帧读 getScrollBarOffset()，
        // 这里用 AnimationTimer 每帧同步，且只在滚动值变化时才重绘——
        // setScroll 内部会重画模糊底，不去重会白白吃掉 CPU。
        new AnimationTimer() {
            private double lastScroll = -1;

            @Override
            public void handle(long now) {
                if (rightTitleBar == null || playerPanel == null) {
                    return;
                }
                double s = playerPanel.searchBox().resultScroll();
                if (Math.abs(s - lastScroll) > 0.01) {
                    lastScroll = s;
                    rightTitleBar.setScroll(s);
                }
            }
        }.start();

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

        // 界面缩放（对应原版 main.js:204-207 的 force-device-scale-factor）。
        // 只作用于面板：教程窗是铺满主屏的，缩了会在边缘露出空白。
        UiScale.apply(stage, Theme.PANEL_W, Theme.PANEL_H);

dock = new EdgeDock(stage);
        // 半透明挂面板根节点（对应原版 .sigma-music-player）；
        // ElasticReveal 动的是外层 overlay，两者不抢同一个 opacity
        dock.attachOpacityTarget(root);
        // 收起态那条 41px 触发条要跟着吸附态开关。注意鼠标拖出去被吸走也算收起，
        // 只在 RSHIFT 收起时开关的话，拖出去之后就点不回来了
        dock.onDockStateChanged(
                () -> playerPanel.setDockTriggerActive(dock.isDocked()));
        installDragHandlers(root);
        dock.expand();
        reveal.expand(null);

        // 二次启动唤醒：拿到锁的那个实例负责响应
        watchSecondInstance();

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
        closeSettings();
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

    /** 去设置页。 */
    private void switchToSettings() {
        closeOnboardingStage();
        if (login != null) {
            login.setVisible(false);
        }
        if (settings == null) {
            settings = new SettingsView();
            settings.setId("sigma-settings");
            settings.loadFromPrefs();
            settings.onBack(this::switchToPlayer);
            // 频谱四项：原版 SpectrumHUD.vue 靠 spectrum-setting-changed 事件即时生效，
            // 这里照同样思路在设置变更时立刻套到当前 feed / view，不必重启也不必重开频谱窗。
            settings.onChange("spectrumScale", v -> applySpectrumSettings(feed, spectrumView));
            settings.onChange("spectrumSigmaSmoothing", v -> applySpectrumSettings(feed, spectrumView));
            settings.onChange("spectrumAvDelay", v -> applySpectrumSettings(feed, spectrumView));
            settings.onChange("spectrumLocked", v -> applySpectrumSettings(feed, spectrumView));
            // 开机自启：原版 main.js:273-277 用 app.setLoginItemSettings，
            // Java 侧写同一个注册表键（见 system/AutoStart）
            settings.onChange("autoStart", v -> AutoStart.apply("on".equals(v)));
            settings.onAction("showTutorial", () -> {
                AppPrefs.clearOnboardingDone();
                settings.dispose();
                settings = null;
                if (playerView != null) {
                    playerView.setVisible(false);
                }
                startOnboarding();
            });
            stageHolder.getChildren().add(settings);
        }
        settings.setVisible(true);
        if (playerView != null) {
            playerView.setVisible(false);
        }
    }

    private void closeSettings() {
        if (settings != null) {
            settings.dispose();
            settings.setVisible(false);
            stageHolder.getChildren().remove(settings);
            settings = null;
        }
    }

    /** 重新打开教程（对应设置页的「重新观看教程」）。 */
    private void startOnboarding() {
        Rectangle2D bounds = Screen.getScreens().get(0).getVisualBounds();
        onboarding = new OnboardingView(bounds.getWidth(), bounds.getHeight());
        onboarding.setId("sigma-onboarding");
        onboarding.onKeySelect(code -> status("选中按键 " + code));
        onboarding.onFinish(this::completeOnboarding);
        buildOnboardingStage(bounds);
        onboardingStage.show();
        onboarding.layout(bounds.getWidth(), bounds.getHeight());
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
            // 标题用歌单名（权威 method13189 取的是标签页文本）
            setRightTitle(tab.name());
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
                    setRightTitle("每日推荐");
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
                    // 上面可能已经设过歌单名，这里不要覆盖成通用的「歌单」
                    if (rightTitleBar == null || rightTitleBarTitle().isBlank()
                            || "歌单".equals(rightTitleBarTitle())) {
                        setRightTitle("歌单");
                    }
                    status("歌单 " + songs.size() + " 首");
                });
            } catch (Exception e) {
                Platform.runLater(() -> status("加载歌曲失败 -> " + describe(e)));
            }
        });
    }

    /**
     * 设置右栏标题并同步滚动淡入。
     *
     * <p>权威的标题是当前标签页的名字（{@code method13189} 里从
     * {@code var1.getText()} 取），Java 侧左栏是 PlaylistPanel，
     * 这里直接传字符串。
     */
    private void setRightTitle(String title) {
        if (rightTitleBar == null) {
            return;
        }
        rightTitleBar.setTitle(title);
        syncRightTitleScroll();
    }

    /** 右栏滚动变了就刷新标题淡入（权威：offset &lt; 50 时 alpha = offset/50）。 */
    private void syncRightTitleScroll() {
        if (rightTitleBar != null && playerPanel != null) {
            rightTitleBar.setScroll(playerPanel.searchBox().resultScroll());
        }
    }

    private String rightTitleBarTitle() {
        return rightTitleBar == null ? "" : rightTitleBar.titleText();
    }

    /**
     * 当前播放位置（秒）。
     *
     * <p>供 {@link SpectrumFeed} 做音画差对齐。播放器还没就绪时返回 0。
     *
     * <p>注意：进度条 seek 之后这个值会突变，feed 那边靠
     * 「只往后跳」的策略忽略向后的跳变（见 {@code realignToPlayback}）。
     */
    private double playbackSeconds() {
        if (player == null) {
            return 0;
        }
        try {
            return player.getCurrentTime().toSeconds();
        } catch (RuntimeException e) {
            return 0;
        }
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
                    setRightTitle("搜索");
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
                // 之前写死 320，设置项的画质能改却不生效。改成走 QualityResolver：
                // 先问 /privilege/lite 拿实际权限，再按「想要的档 → 逐级往下」试直链，
                // 全失败才退化到 free_part 试听片段。
                final String quality = QualityResolver.selectedQuality();
                String url = QualityResolver.resolve(api, song.getHash(), quality);
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
            // 频谱窗信息块同步（对应 renderSpectrum 的 cover/title）
            updateSpectrumInfo(song.getTitle(), song.getCoverUrl());
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
            // 开始播放：让频谱从「暂停清队列」切回解码，并记住当前进度作为对齐起点
            syncSpectrumPlaying(true);
            if (feed != null) {
                feed.resetAlignment();
            }
        } catch (Exception e) {
            status("初始化播放失败：" + e.getMessage());
        }
    }

    private void rewireSpectrum(String url) {
        if (feed != null) {
            feed.close();
        }
        feed = new SpectrumFeed(url, FFT_SIZE, BAND_COUNT, 60);
        applySpectrumSettings(feed, spectrumView);

        spectrumView.stop();
        spectrumView = new SpectrumView(feed, BAND_COUNT, SPECTRUM_W, SPECTRUM_H);
        // 新 view 也要立刻套上当前设置，否则换歌后用户的参数会退回默认值
        applySpectrumSettings(feed, spectrumView);
        // 换到悬浮窗里：替换掉旧 canvas，保持同一个 Scene/Stage
        if (spectrumStage != null) {
            Pane parent = (Pane) spectrumStage.getScene().getRoot();
            parent.getChildren().set(0, spectrumView.canvas());
        }
        spectrumView.start();

        new AnimationTimer() {
            @Override
            public void handle(long now) {
                // 信息块随低频缩放封面（对应 renderSpectrum 的 glScalef 那段）
                if (spectrumInfo != null && spectrumView != null) {
                    double[] amps = feed == null ? null : feed.levels();
                    spectrumInfo.applyScale(amps == null
                            ? 1.0 : SpectrumView.coverScale(amps));
                }
                if (feed == null || player == null) {
                    return;
                }
                if (feed.error() != null) {
                    status("频谱不可用");
                    return;
                }
                if (player.getStatus() == MediaPlayer.Status.PLAYING
                        && feed.sampleRate() > 0) {
                    status(String.format("播放中 · %d Hz", feed.sampleRate()));
                }
            }
        }.start();
    }

    /** 更新频谱窗的信息块（封面 + 歌名），对应 renderSpectrum :217-240。 */
    private void updateSpectrumInfo(String songTitle, String coverUrl) {
        if (spectrumInfo == null) {
            return;
        }
        spectrumInfo.setTitle(songTitle);
        if (coverUrl != null && !coverUrl.isBlank()) {
            // 后台加载：构造函数返回时宽高还是 0，必须等 progress 到 1 再挂上去。
            // 这条坑在 CanvasStrip.setCover 里踩过一次——加载不完就 setImage，
            // 结果缩放比是 NaN，整张封面画不出来。
            javafx.scene.image.Image img = new javafx.scene.image.Image(coverUrl, true);
            if (img.getProgress() < 1.0) {
                img.progressProperty().addListener((o, was, now) -> {
                    if (now.doubleValue() >= 1.0) {
                        javafx.application.Platform.runLater(
                                () -> spectrumInfo.setCover(img));
                    }
                });
            } else {
                spectrumInfo.setCover(img);
            }
        }
    }

    /**
     * 把设置页的四个频谱项套到当前 feed / view 上。
     *
     * <p>对应原版 {@code SpectrumHUD.vue} 的 {@code spectrum-setting-changed}
     * 与 {@code AudioController.js} 的 {@code setSpectrumDelay}。
     * 设置页每次改动都调这里，所以是「读当前值 → 应用」，而不是启动时读一次。
     */
    private void applySpectrumSettings(SpectrumFeed f, SpectrumView v) {
        if (f != null) {
            f.setLeadSeconds(spectrumAvDelayMs() / 1000.0);
            // 把播放位置喂给 feed，后台线程据此把解码位置对齐到
            // 「播放位置 + 领先量」（对应原版 syncLookahead）。
            // 之前只 setLeadSeconds 而没有位置来源，领先量存着没人用——
            // 那就是第四个死开关。
            f.setPlaybackPosition(this::playbackSeconds);
        }
        if (v != null) {
            v.setSpectrumScale(spectrumScale());
            v.setSpectrumSmoothing(spectrumSmoothing());
        }
        applySpectrumLock();
    }

    /** 读 {@code spectrumScale}，越界回落到 1.0（与原版 parseFloat 兜底一致）。 */
    private double spectrumScale() {
        String raw = AppPrefs.getSetting("spectrumScale", "1.0");
        try {
            double v = Double.parseDouble(raw);
            if (Double.isFinite(v)) {
                return v;
            }
        } catch (NumberFormatException ignored) {
            // 落回默认
        }
        return 1.0;
    }

    /** 读 {@code spectrumSigmaSmoothing}，原版夹到 [0.001, 1]。 */
    private double spectrumSmoothing() {
        String raw = AppPrefs.getSetting("spectrumSigmaSmoothing", "0.335");
        try {
            double v = Double.parseDouble(raw);
            if (Double.isFinite(v)) {
                return Math.max(0.001, Math.min(1, v));
            }
        } catch (NumberFormatException ignored) {
            // 落回默认
        }
        return SpectrumView.DEFAULT_SMOOTHING;
    }

    /** 读 {@code spectrumAvDelay}，原版夹到 [0, 2000]，默认 590ms。 */
    private double spectrumAvDelayMs() {
        String raw = AppPrefs.getSetting("spectrumAvDelay", "590");
        try {
            double v = Double.parseDouble(raw);
            if (Double.isFinite(v)) {
                return Math.max(0, Math.min(2000, v));
            }
        } catch (NumberFormatException ignored) {
            // 落回默认
        }
        return SPECTRUM_AV_DELAY_DEFAULT_MS;
    }

    /** 频谱窗是否锁定（鼠标穿透）。默认锁定，与原版一致。 */
    private boolean spectrumLocked() {
        return !"off".equals(AppPrefs.getSetting("spectrumLocked", "on"));
    }

    /**
     * 应用锁定状态，对应原版 {@code applyLock()}：
     * 锁定 = 鼠标穿透（不可拖动）；解锁 = 可拖动 + 底色加深提示可编辑。
     */
    private void applySpectrumLock() {
        if (spectrumStage == null) {
            return;
        }
        boolean locked = spectrumLocked();
        // 原版 applyLock() 是发 IPC 让 main 进程调 setIgnoreMouseEvents，
        // JavaFX 21 没有对应 API，改走 Win32 的 WS_EX_TRANSPARENT（见 MousePassthrough）
        MousePassthrough.setPassThrough(spectrumStage, locked);
        if (spectrumOutline != null) {
            spectrumOutline.setVisible(!locked);
        }
        spectrumStage.setTitle(locked ? "Jello Spectrum" : "Jello Spectrum（已解锁 · 可拖动）");
    }

    private Stage spectrumStage;
    private Rectangle spectrumOutline;
    private SpectrumInfoBlock spectrumInfo;

    /**
     * 建一个透明、无边框、置顶的频谱悬浮窗，贴在主面板左下外侧。
     *
     * <p>对应原版 {@code SpectrumHUD.vue} 的 {@code .spectrum-hud}：
     * 默认 {@code locked=true}，场景鼠标穿透、不可拖动；双击切换解锁态
     * （原版 {@code dblclick} 监听），解锁后出现虚线边框并可拖动窗口。
     */
    private void buildSpectrumStage(Stage main) {
        spectrumStage = new Stage();
        spectrumStage.initStyle(StageStyle.TRANSPARENT);
        spectrumStage.setTitle("Jello Spectrum");
        spectrumStage.setAlwaysOnTop(true);

        Pane holder = new Pane();
        holder.getChildren().add(spectrumView.canvas());

        // 左下角信息块（封面 + 歌名），对应 MusicManager.renderSpectrum :215-240
        spectrumInfo = new SpectrumInfoBlock();
        spectrumInfo.setPrefSize(SPECTRUM_W, SPECTRUM_H);
        spectrumInfo.setLayoutX(0);
        spectrumInfo.setLayoutY(0);
        holder.getChildren().add(spectrumInfo);

        // 解锁态提示：原版 .spectrum-hud.hud-editing 的 2px 虚线 + 圆角 6
        spectrumOutline = new Rectangle(SPECTRUM_W, SPECTRUM_H);
        spectrumOutline.setArcWidth(12);
        spectrumOutline.setArcHeight(12);
        spectrumOutline.setFill(Color.TRANSPARENT);
        spectrumOutline.setStroke(Color.color(1, 1, 1, 0.4));
        spectrumOutline.setStrokeWidth(2);
        spectrumOutline.setStrokeDashOffset(4);
        spectrumOutline.setMouseTransparent(true);
        spectrumOutline.setVisible(false);
        holder.getChildren().add(spectrumOutline);

        Scene sc = new Scene(holder, SPECTRUM_W, SPECTRUM_H);
        sc.setFill(Color.TRANSPARENT);
        spectrumStage.setScene(sc);
        // 频谱窗跟着面板一起缩放，否则面板放大后频谱条还是原尺寸，看着不成一套
        UiScale.apply(spectrumStage, SPECTRUM_W, SPECTRUM_H);

        installSpectrumDrag();
        applySpectrumLock();

        // 位置优先用上次存的（对应原版 spectrumWindowPosition），没有才贴主面板
        if (!restoreSpectrumPosition()) {
            repositionSpectrum(main);
        }
        persistSpectrumPositionOnExit();
        spectrumStage.hide();
        // 对应原版 SigmaMusicPlayer.vue:260 —— 启动时按 settings.desktopSpectrum 恢复
        if (spectrumOnByDefault()) {
            spectrumStage.show();
            playerPanel.setSpectrumActive(true);
        }
    }

    /** 频谱窗拖动：只有解锁态可拖，对应原版 {@code -webkit-app-region: drag}。 */
    private void installSpectrumDrag() {
        Pane holder = (Pane) spectrumStage.getScene().getRoot();
        final double[] dragOffset = new double[2];
        holder.setOnMousePressed(e -> {
            if (spectrumLocked() || e.getButton() != javafx.scene.input.MouseButton.PRIMARY) {
                return;
            }
            dragOffset[0] = e.getScreenX() - spectrumStage.getX();
            dragOffset[1] = e.getScreenY() - spectrumStage.getY();
        });
        holder.setOnMouseDragged(e -> {
            if (spectrumLocked()) {
                return;
            }
            javafx.geometry.Rectangle2D area =
                    javafx.stage.Screen.getPrimary().getVisualBounds();
            double x = e.getScreenX() - dragOffset[0];
            double y = e.getScreenY() - dragOffset[1];
            spectrumStage.setX(Math.max(area.getMinX(), Math.min(x, area.getMaxX() - SPECTRUM_W)));
            spectrumStage.setY(Math.max(area.getMinY(), Math.min(y, area.getMaxY() - SPECTRUM_H)));
            // 原版 electron/main.js:459 在移动时同步写盘，这里在拖动结束前先记一次，
            // 免得用户拖完直接关应用（没触发 onHidden）就丢了位置
            AppPrefs.setSpectrumWindowPosition(spectrumStage.getX(), spectrumStage.getY());
        });
        // 原版双击切换锁定态
        holder.setOnMouseClicked(e -> {
            if (e.getClickCount() == 2 && e.getTarget() == holder) {
                AppPrefs.setSetting("spectrumLocked",
                        spectrumLocked() ? "off" : "on");
                AppPrefs.putSettings(java.util.Map.of());
                applySpectrumLock();
            }
        });
    }

    /** 读回上次保存的频谱窗位置；没有或已移出屏幕时返回 false。 */
    private boolean restoreSpectrumPosition() {
        double[] pos = AppPrefs.spectrumWindowPosition();
        if (pos == null) {
            return false;
        }
        javafx.geometry.Rectangle2D area = javafx.stage.Screen.getPrimary().getVisualBounds();
        // 上次的位置可能落在已拔掉的显示器上，判一下是否还在可见范围内
        boolean visible = pos[0] + SPECTRUM_W > area.getMinX()
                && pos[0] < area.getMaxX()
                && pos[1] + SPECTRUM_H > area.getMinY()
                && pos[1] < area.getMaxY();
        if (!visible) {
            return false;
        }
        spectrumStage.setX(pos[0]);
        spectrumStage.setY(pos[1]);
        return true;
    }

    /** 频谱窗关闭时记住位置（原版 electron/main.js:459 同样在移动时写盘）。 */
    private void persistSpectrumPositionOnExit() {
        spectrumStage.setOnHidden(e -> {
            if (spectrumStage != null) {
                AppPrefs.setSpectrumWindowPosition(spectrumStage.getX(), spectrumStage.getY());
            }
        });
    }

    private void repositionSpectrum(Stage main) {
        if (spectrumStage == null) {
            return;
        }
        javafx.geometry.Rectangle2D area = javafx.stage.Screen.getPrimary().getVisualBounds();
        double x = main.getX() + 12;
        double y = main.getY() + Theme.PANEL_H - 72;
        spectrumStage.setX(Math.max(area.getMinX(), Math.min(x, area.getMaxX() - SPECTRUM_W)));
        spectrumStage.setY(Math.max(area.getMinY(), Math.min(y, area.getMaxY() - SPECTRUM_H)));
    }

    private void toggleSpectrumWindow() {
        if (spectrumStage == null) {
            return;
        }
        if (spectrumStage.isShowing()) {
            spectrumStage.hide();
            playerPanel.setSpectrumActive(false);
            setSpectrumOn(false);
        } else {
            spectrumStage.show();
            playerPanel.setSpectrumActive(true);
            setSpectrumOn(true);
        }
    }

    /**
     * 频谱窗开关的持久化，对应原版设置项 {@code desktopSpectrum}
     * （{@code settings.js:46-57}，默认 off；
     * {@code SigmaMusicPlayer.vue:244} 切换时写回 settings）。
     */
    private void setSpectrumOn(boolean on) {
        AppPrefs.setSetting(SPECTRUM_ON_KEY, on ? "on" : "off");
        AppPrefs.putSettings(java.util.Map.of());
    }

    /** 启动时按设置决定频谱窗是否显示。 */
    private boolean spectrumOnByDefault() {
        return "on".equals(AppPrefs.getSetting(SPECTRUM_ON_KEY, "off"));
    }

    /**
     * 播放 / 暂停。
     *
     * <p>同步通知频谱：对应原版 {@code playing-status} 事件——暂停时清空幅度，
     * 条形立即消失；恢复时下一帧直接吸附到目标，不做渐变。
     */
    private void togglePlay() {
        if (player == null) {
            return;
        }
        if (player.getStatus() == MediaPlayer.Status.PLAYING) {
            player.pause();
            syncSpectrumPlaying(false);
        } else {
            player.play();
            syncSpectrumPlaying(true);
        }
    }

    private void syncSpectrumPlaying(boolean playing) {
        if (feed != null) {
            feed.setPlaying(playing);
        }
        if (!playing && spectrumView != null) {
            spectrumView.clear();
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

/**
 * 系统托盘。设置入口在这（原版也是从托盘进设置，面板左下角放不下也不该放）。
 */
    private void setupTray() {
        tray = new TrayIconHelper();
        tray.onPlayPause = this::togglePlay;
        tray.onPrev = () -> playCurrent(queue.previous());
        tray.onNext = () -> playCurrent(queue.next());
        tray.onSettings = this::switchToSettings;
        tray.onTogglePanel = this::toggleDock;
        tray.onQuit = () -> Platform.runLater(this::quitApp);
        tray.install();
    }

    private void quitApp() {
        disposePlayer();
        if (tray != null) {
            tray.dispose();
        }
        Platform.exit();
    }

    private void toggleDock() {
        // 原版 SIGMA_TOGGLE_THROTTLE_MS = 120：连按时丢弃过密的请求，
        // 但动画本身照样跑完，只是不再反复反转。节流要罩住整条 RSHIFT 路径
        // （位置滑出 + ElasticReveal 一起），不能只卡其中一段。
        long now = System.currentTimeMillis();
        if (now - lastToggleAt < 120) {
            return;
        }
        lastToggleAt = now;
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
     * 轮询二次启动信号，把已有窗口提到最前。
     *
     * <p>对应原版 {@code second-instance}（electron/main.js:111-133）：
     * 窗口最小化了就 restore，否则把 Sigma 窗口拉到最前——
     * 贴边收起时会顺带滑出，这就是「再点一次图标就能唤回来」的体验。
     *
     * <p>Java 侧没有 OS 级「二次启动回调」，只能靠 {@link SingleInstance} 的
     * 请求文件轮询。500ms 间隔足够（人感知不到），也够省。
     */
    private void watchSecondInstance() {
        if (instance == null) {
            return;
        }
        new AnimationTimer() {
            @Override
            public void handle(long now) {
                if (!instance.takePendingCommand()) {
                    return;
                }
                if (sigmaStage == null) {
                    return;
                }
                if (dock != null && dock.isDocked()) {
                    expandDock();
                }
                // 面板是 TRANSPARENT 无边框窗，JavaFX 不允许最小化，
                // 所以原版的 isMinimized → restore 这一支在这里没有对应物，
                // 只需 toFront + requestFocus 把它拉到最前。
                sigmaStage.toFront();
                sigmaStage.requestFocus();
                if (spectrumStage != null && spectrumStage.isShowing()) {
                    spectrumStage.toFront();
                }
            }
        }.start();
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

    /** 单实例锁：抢不到就是二次启动，通知已有实例唤醒后立刻退出。 */
    private static SingleInstance instance;

    public static void main(String[] args) {
        // 对应原版 electron/main.js:105-109：
        //   if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
        // 必须在 launch() 之前判断——一旦 launch 就会建窗口，退出时可能闪一下
        if (SingleInstance.isSupported()) {
            instance = SingleInstance.tryAcquire();
            if (instance == null) {
                // tryAcquire 已经给已有实例写过唤醒信号，这里直接退
                System.out.println("[Jello] 已在运行，唤醒已有实例");
                return;
            }
        }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            if (instance != null) {
                instance.close();
            }
        }));
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