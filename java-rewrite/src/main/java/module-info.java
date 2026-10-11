/**
 * Jello Music Java 版。
 *
 * <p>JavaFX 要求以模块方式加载，不能放在 classpath 上运行
 * （classpath 启动会报 "Unsupported JavaFX configuration: classes were loaded
 * from 'unnamed module'"）。因此本项目按模块组织，打包与运行时都走 module path。
 *
 * <p>模块依赖：
 * <ul>
 *   <li>javafx.controls / javafx.media —— 界面与播放</li>
 *   <li>javafx.fxml —— 后续界面若改用 FXML</li>
 *   <li>jackson.databind —— JSON</li>
 *   <li>java.net.http —— 调 api 与拉音频流</li>
 *   <li>jlayer —— 纯 Java MP3 解码（旁路取 PCM 算频谱）</li>
 *   <li>com.sun.jna —— 调 Win32 的 GetAsyncKeyState 做全局 RSHIFT 热键</li>
 *   <li>slf4j —— 日志</li>
 * </ul>
 */
module com.jello.music {
    requires javafx.controls;
    requires javafx.media;
    requires javafx.fxml;
    requires com.fasterxml.jackson.databind;
    requires com.sun.jna;
    requires java.net.http;
    requires java.desktop;
    // 新手教程完成标记等本地设置（对应原版的 localStorage）
    requires java.prefs;
    requires jlayer;
    requires org.slf4j;

    exports com.jello.music;
    exports com.jello.music.api;
    exports com.jello.music.model;
    exports com.jello.music.player;
    exports com.jello.music.system;
    exports com.jello.music.ui;
    exports com.jello.music.tools;
}