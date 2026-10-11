package com.jello.music.ui;

import com.jello.music.api.KuGouApiClient;
import com.jello.music.model.UserInfo;
import javafx.animation.AnimationTimer;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Label;
import javafx.scene.control.PasswordField;
import javafx.scene.control.TextField;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.layout.Background;
import javafx.scene.layout.BackgroundFill;
import javafx.scene.layout.Border;
import javafx.scene.layout.BorderWidths;
import javafx.scene.layout.BorderStroke;
import javafx.scene.layout.BorderStrokeStyle;
import javafx.scene.layout.CornerRadii;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.scene.text.FontWeight;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * 登录页 —— 1:1 复刻原版 {@code Login.vue}（嵌在 {@code SigmaUI} 的 {@code view === 'login'}）。
 *
 * <p>三种登录方式：手机号+验证码 / 账号密码 / 扫码，外加「该手机绑了多个账号」的
 * 账号选择页。配色/圆角/尺寸照抄 {@code Login.vue} 的 scss。
 *
 * <p><b>关于主题色</b>：原版到处写 {@code var(--primary-color)}，但这个变量<b>在整个仓库里
 * 从未被定义</b>——CSS 里未定义的 var 会让整条声明作废，所以原版登录页实际渲染出来是
 * 灰的（主按钮没有底色、选中分段也没有高亮）。这里按 1:1 照抄成 {@link #PRIMARY}；
 * 想让它显示粉色，改这一个常量即可。
 *
 * <p><b>控件都基于 {@link StackPane}</b>：{@code Region.getChildren()} 是 protected，
 * 想在圆角盒子里放文字只能用 Pane 的子类。
 */
public final class LoginView extends Pane {

    /**
     * 原版未定义的 {@code --primary-color}。
     * <p>改成 {@code Color.web("#e18fa8")} 就是「看起来本该有的样子」，但那就不是 1:1 了。
     */
    public static final Color PRIMARY = null;

    private static final String LOGO_URL =
            "https://www.kugou.com/yy/static/images/play/logo.png";

    private static final Color PAGE_BG = Color.color(16 / 255.0, 17 / 255.0, 20 / 255.0, 0.96);
    private static final Color CARD_BG = Color.color(22 / 255.0, 20 / 255.0, 28 / 255.0, 0.78);
    private static final Color CARD_BORDER = Color.color(1, 1, 1, 0.08);
    private static final Color INPUT_BG = Color.color(1, 1, 1, 0.06);
    private static final Color INPUT_BORDER = Color.color(1, 1, 1, 0.14);
    private static final Color MUTED = Color.web("#bdb7c9");
    private static final Color DIM_TEXT = Color.web("#a39dae");
    private static final Color TITLE_TEXT = Color.web("#f2eff6");
    private static final Color ERROR = Color.web("#f56c6c");
    private static final Color SEG_BG = Color.color(1, 1, 1, 0.05);
    private static final Color SEG_HOVER = Color.color(1, 1, 1, 0.10);
    private static final Color WHITE_08 = Color.color(254 / 255.0, 254 / 255.0, 254 / 255.0, 0.08);

    private static final double CARD_W = 400;
    private static final double CARD_H = 470;
    private static final double INPUT_H = 42;
    private static final double BAR_H = 48;

    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "jello-login");
        t.setDaemon(true);
        return t;
    });
    private final ExecutorService qrPoll = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "jello-qr");
        t.setDaemon(true);
        return t;
    });

    private final KuGouApiClient api;
    private final Region card = new Region();
    private final Label cardTitle = new Label("登录你的酷狗账号");
    private final ImageView logo = new ImageView();
    private final Region accent = new Region();

    private final List<Segment> segments = new ArrayList<>();
    private final List<Pane> tabs = new ArrayList<>();

    private final TextField phoneField = new TextField();
    private final TextField codeField = new TextField();
    private final Box sendCodeBtn = new Box("发送验证码", 100, INPUT_H, 10, SEG_HOVER, Color.WHITE, 13);
    private final Box phoneLoginBtn = new Box("立即登录", CARD_W - 50, INPUT_H, 10, SEG_HOVER,
            Color.WHITE, 15);
    private final Label phoneError = new Label();

    private final TextField emailField = new TextField();
    private final PasswordField passwordField = new PasswordField();
    private final Box emailLoginBtn = new Box("账号登录", CARD_W - 50, INPUT_H, 10, SEG_HOVER,
            Color.WHITE, 15);
    private final Label emailError = new Label();

    private final Label qrTips = new Label("请使用酷狗扫描二维码登录");
    private final ImageView qrImage = new ImageView();
    private final Region qrPlaceholder = new Region();
    private final Label qrEmptyText = new Label("正在生成二维码...");

    private final Pane accountPane = new Pane();
    private final Label accountTip = new Label("该手机绑定多个账号，请选择要登录的账号");
    private final Pane accountList = new Pane();

    private final Region disclaimer = new Region();
    private final Label disclaimerText = new Label("本软件承诺不会保存你的任何账号信息到云端。"
            + "你的密码会在本地进行加密后再传输到酷狗官方。本软件并非酷狗官方网站，"
            + "输入账号信息前请慎重考虑，非所有账号都支持账号密码登录.推荐使用验证码登录.");
    private final Label registerText = new Label("还没有账号？");
    /** 提示框左上角的「!」徽标（原版 .disclaimer::before），单独留着要定位。 */
    private final Box disclaimerBadge = new Box("!", 18, 18, 9,
            PRIMARY == null ? ERROR : PRIMARY, Color.WHITE, 11);
    /** 标题下的渐变下划线（原版 h2::after：left 30%、宽 40%、高 3px）。 */
    private final Region titleUnderline = new Region();

    private final Box backButton = new Box("‹", 32, 32, 6, WHITE_08, Color.WHITE, 18);

    private volatile String qrKey = "";
    private volatile boolean qrRunning;
    private Consumer<UserInfo> onSuccess;
    private Runnable onBack;
    private int countdown;
    private AnimationTimer countdownTimer;

    public LoginView(KuGouApiClient api) {
        this.api = api;
        setPrefSize(Theme.PANEL_W, Theme.PANEL_H);
        setBackground(Background.fill(PAGE_BG));
build();
        showTab(0);
        // 注意必须写全名：Parent 有一个 protected final void layout() 空实现，
        // 写成 layout() 会静默变成「什么都不做」，整页保持 0 尺寸且不报错
        layoutAll();
    }

    // ================= 圆角盒子 =================

    /** 可点击的圆角盒子，文字居中。 */
    public static final class Box extends StackPane {
        private final Label label;
        private final double radius;

        private Box(String text, double w, double h, double radius, Color bg, Color fg,
                    double fontSize) {
            this.radius = radius;
            setPrefSize(w, h);
            setMinSize(w, h);
            setMaxSize(w, h);
            paint(bg);
            label = new Label(text);
            label.setFont(Font.font(fontSize));
            label.setTextFill(fg);
            label.setMouseTransparent(true);
            getChildren().add(label);
            StackPane.setAlignment(label, Pos.CENTER);
        }

        private void paint(Color bg) {
            setBackground(new Background(
                    new BackgroundFill(bg, new CornerRadii(radius), null)));
        }

        private void text(String s) {
            label.setText(s);
        }
    }

    /** 带 1px 描边的盒子（账号选择项、返回按钮外框）。 */
    private static void outline(Region node, double radius, Color color) {
node.setBorder(new Border(new BorderStroke(color, BorderStrokeStyle.SOLID,
                new CornerRadii(radius), BorderStroke.THIN, new Insets(1))));
    }

    // ================= 骨架 =================

    private void build() {
        backButton.setLayoutX(10);
        backButton.setLayoutY(8);
        backButton.setOnMouseEntered(e -> backButton.paint(WHITE_08.brighter()));
        backButton.setOnMouseClicked(e -> {
            if (onBack != null) {
                onBack.run();
            }
        });
        getChildren().add(backButton);

        card.setBackground(new Background(
                new BackgroundFill(CARD_BG, new CornerRadii(20), Insets.EMPTY)));
        outline(card, 20, CARD_BORDER);
        getChildren().add(card);

        accent.setPrefSize(CARD_W - 2, 3);
        accent.setBackground(Background.fill(PRIMARY == null ? Color.TRANSPARENT : PRIMARY));
        getChildren().add(accent);

        logo.setPreserveRatio(true);
        logo.setSmooth(false);
        getChildren().add(logo);
        loadLogo();

        cardTitle.setFont(Font.font(null, FontWeight.SEMI_BOLD, 22));
        cardTitle.setTextFill(TITLE_TEXT);
        cardTitle.setPrefWidth(240);
        cardTitle.setAlignment(Pos.CENTER);
        getChildren().add(cardTitle);

        double segW = (CARD_W - 50) / 3.0;
        String[] names = {"手机号登录", "账号登录", "扫码登录"};
        for (int i = 0; i < names.length; i++) {
            Segment seg = new Segment(names[i], segW);
            segments.add(seg);
            getChildren().add(seg);
        }

        buildPhoneTab();
        buildEmailTab();
        buildQrTab();
        buildAccountPane();
        buildFooter();
    }

    private void loadLogo() {
        try {
            Image img = new Image(LOGO_URL, 65, 65, true, true);
            if (img.getWidth() > 0 && img.getHeight() > 0) {
                logo.setImage(img);
            }
        } catch (Exception ignored) {
            // 拉不到就留空（原版 img 拉不到也是空）
        }
    }

    /** 一个分段按钮：12px 圆角容器 + 1px 分隔线，选中态用主题色。 */
    public final class Segment extends StackPane {
        private final Label label;
        private final Region divider = new Region();
        private boolean active;

        private Segment(String name, double w) {
            setPrefSize(w, 44);
            label = new Label(name);
            label.setFont(Font.font(null, FontWeight.MEDIUM, 14));
            label.setTextFill(MUTED);
            label.setMouseTransparent(true);
            getChildren().add(label);
            StackPane.setAlignment(label, Pos.CENTER);
            divider.setPrefSize(1, 24);
            divider.setLayoutY(10);
            divider.setBackground(Background.fill(Color.color(1, 1, 1, 0.1)));
            divider.setMouseTransparent(true);
            getChildren().add(divider);
            restyle();
        }

        private void restyle() {
            label.setTextFill(active ? Color.WHITE : MUTED);
            setBackground(new Background(new BackgroundFill(
                    active && PRIMARY != null ? PRIMARY : SEG_BG,
                    new CornerRadii(12), null)));
            divider.setVisible(!active);
        }
    }

    // ================= 手机号 =================

    private void buildPhoneTab() {
        Pane p = new Pane();
        p.setPrefSize(CARD_W - 50, 200);
        styleInput(phoneField, "请输入手机号");
        styleInput(codeField, "请输入验证码");
        sendCodeBtn.setOnMouseClicked(e -> sendCaptcha());
        phoneLoginBtn.setOnMouseClicked(e -> phoneLogin(null));
        styleError(phoneError);
        p.getChildren().addAll(phoneField, codeField, sendCodeBtn, phoneLoginBtn, phoneError);
        tabs.add(p);
        getChildren().add(p);
    }

    private void sendCaptcha() {
        String mobile = text(phoneField);
        if (mobile.isEmpty()) {
            error(phoneError, "请输入手机号");
            return;
        }
        if (!mobile.matches("^1\\d{10}$")) {
            error(phoneError, "手机号格式错误");
            return;
        }
        io.execute(() -> {
            try {
                api.sendCaptcha(mobile);
                Platform.runLater(() -> {
                    error(phoneError, "验证码已发送");
                    startCountdown(60);
                });
            } catch (Exception e) {
                Platform.runLater(() -> error(phoneError, "验证码发送失败: " + message(e)));
            }
        });
    }

    private void startCountdown(int seconds) {
        countdown = seconds;
        if (countdownTimer != null) {
            countdownTimer.stop();
        }
        countdownTimer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                sendCodeBtn.text(countdown > 0 ? countdown + "s" : "发送验证码");
                countdown--;
                if (countdown < 0) {
                    stop();
                }
            }
        };
        countdownTimer.start();
    }

    private void phoneLogin(String userid) {
        String mobile = text(phoneField);
        String code = text(codeField);
        if (mobile.isEmpty()) {
            error(phoneError, "请输入手机号");
            return;
        }
        if (code.isEmpty()) {
            error(phoneError, "请输入验证码");
            return;
        }
        error(phoneError, "");
        io.execute(() -> {
            try {
                succeed(api.loginByPhone(mobile, code, userid));
            } catch (KuGouApiClient.MultiAccountException e) {
                // 原版：只有没选账号时才回到账号选择，选了还失败就是真失败
                if (userid == null) {
                    Platform.runLater(() -> showAccountSelection(e.accounts()));
                } else {
                    Platform.runLater(() -> error(phoneError, "登录失败"));
                }
            } catch (Exception e) {
                Platform.runLater(() -> error(phoneError, message(e)));
            }
        });
    }

    // ================= 账号密码 =================

    private void buildEmailTab() {
        Pane p = new Pane();
        p.setPrefSize(CARD_W - 50, 200);
        styleInput(emailField, "请输入登录账号");
        styleInput(passwordField, "请输入密码");
        emailLoginBtn.setOnMouseClicked(e -> emailLogin());
        styleError(emailError);
        p.getChildren().addAll(emailField, passwordField, emailLoginBtn, emailError);
        tabs.add(p);
        getChildren().add(p);
    }

    private void emailLogin() {
        String email = text(emailField);
        String pass = text(passwordField);
        if (email.isEmpty()) {
            error(emailError, "请输入账号");
            return;
        }
        if (pass.isEmpty()) {
            error(emailError, "请输入密码");
            return;
        }
        error(emailError, "");
        io.execute(() -> {
            try {
                succeed(api.loginByEmail(email, pass));
            } catch (Exception e) {
                Platform.runLater(() -> error(emailError, message(e)));
            }
        });
    }

    // ================= 扫码 =================

    private void buildQrTab() {
        Pane p = new Pane();
        p.setPrefSize(CARD_W - 50, 220);
        qrTips.setTextFill(MUTED);
        qrTips.setFont(Font.font(14));
        qrTips.setPrefWidth(CARD_W - 50);
        qrImage.setPreserveRatio(true);
        qrImage.setSmooth(false);
        qrImage.setMouseTransparent(true);
        qrPlaceholder.setPrefSize(200, 200);
        qrPlaceholder.setBackground(new Background(new BackgroundFill(
                Color.color(1, 1, 1, 0.05), new CornerRadii(14), null)));
        qrEmptyText.setTextFill(MUTED);
        qrEmptyText.setFont(Font.font(null, FontWeight.MEDIUM, 14));
        qrEmptyText.setPrefWidth(200);
        qrEmptyText.setLayoutY(90);
        qrEmptyText.setAlignment(Pos.CENTER);
        p.getChildren().addAll(qrTips, qrImage, qrPlaceholder, qrEmptyText);
        tabs.add(p);
        getChildren().add(p);
    }

    private void startQrLogin() {
        qrRunning = true;
        qrKey = "";
        qrImage.setImage(null);
        qrImage.setVisible(false);
        qrPlaceholder.setVisible(true);
        qrTips.setText("请使用酷狗扫描二维码登录");
        qrPoll.execute(() -> {
            try {
                String key = api.qrKey();
                String dataUrl = api.qrImage(key);
                qrKey = key;
                Platform.runLater(() -> {
                    qrImage.setImage(new Image(dataUrl));
                    qrImage.setVisible(true);
                    qrPlaceholder.setVisible(false);
                });
                pollQrStatus();
            } catch (Exception e) {
                Platform.runLater(() -> {
                    qrTips.setText("二维码生成失败");
                    qrEmptyText.setText(message(e));
                });
            }
        });
    }

    private void pollQrStatus() {
        while (qrRunning && !qrKey.isEmpty()) {
            try {
                int st = api.qrStatus(qrKey);
                if (st == 2) {
                    String nick = api.qrNickname(qrKey);
                    String msg = "用户 " + nick + " 已扫码待确认";
                    Platform.runLater(() -> qrTips.setText(msg));
                } else if (st == 4) {
                    qrRunning = false;
                    io.execute(() -> {
                        try {
                            succeed(api.qrCheckForUser(qrKey));
                        } catch (Exception e) {
                            Platform.runLater(() -> qrTips.setText("登录失败: " + message(e)));
                        }
                    });
                    return;
                } else if (st == 0) {
                    qrRunning = false;
                    Platform.runLater(() -> {
                        qrTips.setText("二维码已过期，请重新生成");
                        startQrLogin();
                    });
                    return;
                }
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                qrRunning = false;
                Platform.runLater(() -> qrTips.setText("二维码检测失败"));
                return;
            }
        }
    }

    // ================= 多账号选择 =================

    private void buildAccountPane() {
        accountPane.setPrefSize(CARD_W - 50, 260);
        accountTip.setTextFill(Color.web("#ece9f1"));
        accountTip.setFont(Font.font(13));
        accountTip.setOpacity(0.7);
        accountTip.setWrapText(true);
        accountTip.setPrefWidth(CARD_W - 50);
        accountTip.setPrefHeight(40);

        Box back = new Box("返回登录", 110, 36, 8, Color.color(1, 1, 1, 0.10), Color.WHITE, 14);
        back.setLayoutY(210);
        back.setOnMouseClicked(e -> {
            accountPane.setVisible(false);
            showTab(0);
        });
        accountPane.getChildren().addAll(accountTip, accountList, back);
        accountPane.setVisible(false);
        getChildren().add(accountPane);
    }

    private void showAccountSelection(List<UserInfo> accounts) {
        accountList.getChildren().clear();
        double y = 44;
for (UserInfo a : accounts) {
            // StackPane 而不是 Region：Region.getChildren() 是 protected，放不进头像/文字
            StackPane item = new StackPane();
            item.setLayoutY(y);
            item.setPrefSize(CARD_W - 50, 48);
            item.setMinSize(CARD_W - 50, 48);
            item.setMaxSize(CARD_W - 50, 48);
            item.setBackground(Background.fill(Color.TRANSPARENT));
            outline(item, 12, Color.color(1, 1, 1, 0.12));
            item.setOnMouseEntered(e -> item.setBackground(Background.fill(SEG_HOVER)));
            item.setOnMouseClicked(e -> phoneLogin(a.getUserid()));

            Label name = new Label(a.getNickname().isEmpty() ? "未命名用户" : a.getNickname());
            name.setTextFill(Color.web("#ece9f1"));
            name.setFont(Font.font(14));
            Label grade = new Label("Lv " + a.getGrade());
            grade.setTextFill(Color.web("#ffd166"));
            grade.setFont(Font.font(null, FontWeight.BOLD, 11));
            grade.setLayoutX(56);
            grade.setLayoutY(27);
            Label uid = new Label("UID：" + a.getUserid());
            uid.setTextFill(Color.color(1, 1, 1, 0.5));
            uid.setFont(Font.font(11));
            uid.setLayoutX(120);
            uid.setLayoutY(27);
            Label arrow = new Label("→");
            arrow.setTextFill(MUTED);
            arrow.setLayoutX(CARD_W - 76);
            arrow.setLayoutY(14);
            name.setLayoutX(56);
            name.setLayoutY(6);
            item.getChildren().addAll(name, grade, uid, arrow);
            if (!a.getPic().isEmpty()) {
                try {
                    ImageView avatar = new ImageView(new Image(a.getPic(), 40, 40, true, true));
                    avatar.setPreserveRatio(true);
                    avatar.setLayoutX(8);
                    avatar.setLayoutY(4);
                    item.getChildren().add(avatar);
                } catch (Exception ignored) {
                    // 头像拉不到就只显示文字（原版也有 profile.png 兜底）
                }
            }
            accountList.getChildren().add(item);
            y += 60;
        }
        accountPane.setVisible(true);
        tabs.forEach(t -> t.setVisible(false));
    }

    // ================= 底部 =================

    private void buildFooter() {
        disclaimer.setPrefSize(CARD_W - 50, 76);
        disclaimer.setBackground(new Background(new BackgroundFill(
                Color.color(1, 1, 1, 0.04), new CornerRadii(10), null)));
        disclaimerText.setTextFill(DIM_TEXT);
        disclaimerText.setFont(Font.font(12));
        disclaimerText.setWrapText(true);
        disclaimerText.setPrefWidth(CARD_W - 78);
registerText.setTextFill(MUTED);
        registerText.setFont(Font.font(13));

        // 「!」徽标（原版 disclaimer::before：left 20px、top -10px、18x18）
        getChildren().addAll(disclaimer, disclaimerText, disclaimerBadge, registerText,
                titleUnderline);
    }

    // ================= 通用 =================

    private void styleInput(javafx.scene.control.TextInputControl f, String hint) {
        f.setPrefSize(CARD_W - 50, INPUT_H);
        f.setFont(Font.font(14));
        f.setPromptText(hint);
        // TextField 没有 setTextFill，只能走 CSS；JavaFX 的 rgba() 分量是 0..1
        f.setStyle("-fx-background-color: rgba(1,1,1,0.06);"
                + " -fx-text-fill: #f0edf5; -fx-prompt-text-fill: rgba(1,1,1,0.4);"
                + " -fx-background-radius: 10; -fx-border-color: rgba(1,1,1,0.14);"
                + " -fx-border-radius: 10; -fx-highlight-fill: rgba(1,1,1,0.22);");
    }

    private void styleError(Label label) {
        label.setTextFill(ERROR);
        label.setFont(Font.font(12));
        label.setVisible(false);
    }

    private void error(Label target, String msg) {
        target.setText(msg == null ? "" : msg);
        target.setVisible(msg != null && !msg.isEmpty());
    }

    private static String text(javafx.scene.control.TextInputControl f) {
        return f.getText() == null ? "" : f.getText().trim();
    }

    private static String message(Throwable e) {
        Throwable cur = e;
        while (cur.getCause() != null
                && (cur.getMessage() == null || cur.getMessage().isEmpty())) {
            cur = cur.getCause();
        }
        return cur.getMessage() == null ? cur.getClass().getSimpleName() : cur.getMessage();
    }

    private void succeed(UserInfo user) {
        Platform.runLater(() -> {
            if (onSuccess != null) {
                onSuccess.accept(user);
            }
        });
    }

    // ================= 布局 =================

    private void showTab(int index) {
        for (int i = 0; i < tabs.size(); i++) {
            tabs.get(i).setVisible(i == index);
        }
        accountPane.setVisible(false);
        for (int i = 0; i < segments.size(); i++) {
            segments.get(i).active = i == index;
            segments.get(i).restyle();
        }
        if (index == 2) {
            startQrLogin();
        } else {
            qrRunning = false;
        }
    }

    private void layoutAll() {
        double w = getPrefWidth();
        double h = getPrefHeight();
        double cardX = (w - CARD_W) / 2;
        double top = BAR_H + Math.max(0, (h - BAR_H - CARD_H) / 2.0);

        card.setLayoutX(cardX);
        card.setLayoutY(top);
        card.setPrefSize(CARD_W, CARD_H);
        accent.setLayoutX(cardX + 1);
        accent.setLayoutY(top);

        double innerX = 25;
        double y = top + 30;
        logo.setLayoutX(cardX + (CARD_W - 65) / 2);
        logo.setLayoutY(y);
        y += 68;
        cardTitle.setLayoutX(cardX + (CARD_W - 240) / 2);
        cardTitle.setLayoutY(y);
        y += 40;

        double segW = (CARD_W - 50) / 3.0;
        for (int i = 0; i < segments.size(); i++) {
            Segment s = segments.get(i);
            s.setLayoutX(cardX + innerX + i * segW);
            s.setLayoutY(y);
            s.divider.setLayoutX(segW - 0.5);
        }
        y += 56;

        for (Pane tab : tabs) {
            tab.setLayoutX(cardX + innerX);
            tab.setLayoutY(y);
        }

        phoneField.setLayoutY(0);
        codeField.setLayoutY(INPUT_H + 16);
        codeField.setPrefWidth(CARD_W - 50 - 100);
        sendCodeBtn.setLayoutX(CARD_W - 50 - 100);
        sendCodeBtn.setLayoutY(INPUT_H + 16);
        phoneLoginBtn.setLayoutY(INPUT_H * 2 + 32);
        phoneError.setLayoutY(INPUT_H * 2 + 44);
        phoneError.setPrefWidth(CARD_W - 50);

        emailField.setLayoutY(0);
        passwordField.setLayoutY(INPUT_H + 16);
        emailLoginBtn.setLayoutY(INPUT_H * 2 + 32);
        emailError.setLayoutY(INPUT_H * 2 + 44);
        emailError.setPrefWidth(CARD_W - 50);

        qrTips.setLayoutX(0);
        qrTips.setLayoutY(8);
        qrImage.setLayoutX((CARD_W - 50 - 180) / 2);
        qrImage.setLayoutY(40);
        qrPlaceholder.setLayoutX((CARD_W - 50 - 200) / 2);
        qrPlaceholder.setLayoutY(28);

        accountPane.setLayoutX(cardX + innerX);
        accountPane.setLayoutY(y);
        accountTip.setLayoutX(0);
        accountTip.setLayoutY(0);

disclaimer.setLayoutX(cardX + innerX);
        disclaimer.setLayoutY(top + CARD_H - 76 - 4);
        disclaimerText.setLayoutX(cardX + innerX + 14);
        disclaimerText.setLayoutY(top + CARD_H - 76 + 8);
        disclaimerBadge.setLayoutX(cardX + innerX + 20);
        disclaimerBadge.setLayoutY(top + CARD_H - 76 - 14);
        registerText.setLayoutX(cardX + (CARD_W - 90) / 2);
        registerText.setLayoutY(top + CARD_H + 14);
        // 标题渐变下划线：left 30% / width 40% / bottom -6
        titleUnderline.setLayoutX(cardX + 240 * 0.3);
        titleUnderline.setLayoutY(cardTitle.getLayoutY() + 34);
        titleUnderline.setPrefSize(240 * 0.4, 3);
        titleUnderline.setBackground(Background.fill(PRIMARY == null
                ? Color.color(254 / 255.0, 254 / 255.0, 254 / 255.0, 0.25)
                : PRIMARY));
        titleUnderline.setMouseTransparent(true);
    }

    // ================= 对外 =================

    public void onSuccess(Consumer<UserInfo> c) {
        this.onSuccess = c;
    }

    public void onBack(Runnable r) {
        this.onBack = r;
    }

    /** 切到指定页（0 手机号 / 1 账号 / 2 扫码）。 */
    public void showTabByIndex(int index) {
        showTab(index);
    }

    public void showAccountSelectionForTest(List<UserInfo> accounts) {
        showAccountSelection(accounts);
    }

    public void setErrorForTest(String msg) {
        error(phoneError, msg);
    }

    public Region cardNode() {
        return card;
    }

    public List<Segment> segmentNodes() {
        return segments;
    }

    public TextField phoneInput() {
        return phoneField;
    }

    public TextField codeInput() {
        return codeField;
    }

    public TextField emailInput() {
        return emailField;
    }

    public PasswordField passwordInput() {
        return passwordField;
    }

    public Pane accountPaneNode() {
        return accountPane;
    }

    public Box sendCodeButton() {
        return sendCodeBtn;
    }

    public Box loginButton() {
        return phoneLoginBtn;
    }

    public Label qrTipLabel() {
        return qrTips;
    }

    public Box backButtonNode() {
        return backButton;
    }

    /** 切走时停掉扫码轮询与倒计时。 */
    public void dispose() {
        qrRunning = false;
        if (countdownTimer != null) {
            countdownTimer.stop();
        }
        io.shutdownNow();
        qrPoll.shutdownNow();
    }
}