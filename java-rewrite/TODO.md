# Java 移植 · 待办清单

对照 `src/`（Electron + Vue 原版）与 `java-rewrite/` 逐项核出来的缺口。
按「先修 bug，再补视图」的顺序推进。

状态图例：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成

---

## D. 已知 bug（优先，先修）

- [x] **教程期间 RSHIFT 没挂起** —— `RightShiftPoller.setSuspended()` 定义了但 `MainApp` 从没调用，
      用户在键盘教程里按 Shift 会把窗口收起。原版专门 suspend 过防这个（`SigmaUI.vue:128-131`）
- [x] **音量跨歌丢失** —— `MainApp` 每首歌开始都 `player.setVolume(0.8)`，把用户拖出来的音量冲掉。
      原版音量是保持的（`SigmaMusicPlayer.vue` 的 `volumePercent`）

## A. 两个视图完全没做

- [~] **登录页**（`src/views/Login.vue`，973 行）
      - [x] 三段切换：手机号+验证码 / 邮箱 / 扫码
      - [x] 多账号选择流程（`data.info_list` 那条分支，抛 `MultiAccountException`）
      - [x] 六个接口：`/login`、`/captcha/sent`、`/login/cellphone`、`/login/qr/key|create|check`
      - [x] `SigmaUI.vue` 的 view 接线：教程 → 未登录进登录页 → 登录成功回主界面并重拉歌单
      - [x] 教程按 mod 的 `KeyboardScreen` 做法单独开一个铺满主屏的无边框窗口，
            点「完成」才显示 800x600 的 Sigma 窗口（全屏下键盘按 1:1 原尺寸显示，
            挤在 800x600 里要缩到 0.649）
      - [x] 登录态持久化（`AppPrefs`，对应原版 localStorage 的 `MoeData`），
            优先级：上次登录 > `JELLO_*` 环境变量
      - [ ] 真实接口联调（需要 `npm run api` + 可用的手机号/邮箱）
      - [ ] **待用户确认**：原版的 `--primary-color` 全仓库从未定义，CSS 里未定义的 var
            会让声明作废，所以原版登录页实际渲染出来是灰的。现在按 1:1 留空
            （`LoginView.PRIMARY = null`）；若想显示粉色改这一个常量即可
- [x] **设置页**（`src/views/Settings.vue`，1630 行，4 分类 30+ 项）
      - [x] 先砍清单：Electron 专属项（托盘菜单、代理、自定义 API 地址、日志导出、
            自动更新、API 模式）在 Java 版没有对应物 → 30 项砍到 **9 项**
      - [x] 保留项对照：界面 6（重新观看教程 / 频谱幅度 / 平滑系数 / 音画差补偿 /
            频谱锁定 / 界面缩放）、声音 1（音质选择）、系统 2（开机自启 / 全局快捷键占位）
      - [x] 视图骨架：180px 分类栏 + 紧凑行 + 每分类「重置」+ 返回箭头
      - [x] 设置入口走系统托盘右键菜单（面板左下角被封面和 41px 触发条夹着，放不下）
      - [x] 持久化：复用原版 key 名（`spectrumScale` 等），存 `AppPrefs`
      - [ ] `开机自启` / `界面缩放` / `全局快捷键` 三项目前只存值不生效（依赖 C 组能力）

## B. 播放器内的缺口

- [x] **第 4 种循环状态（随机播放）** —— `RepeatButton` 原硬夹在 `0..2`，
      原版 4 态、第 4 态是内联 SVG 随机图标；`PlayQueue.Repeat` 已加 SHUFFLE。
      坑：模式索引 ≠ 雪碧图帧号（随机↔顺序对调）；随机图标走 SVG 不走 `repeat.png`；
      JavaFX 缩放绕 layoutBounds 中心，定位要用「目标中心 - 字形中心」，
      用 StackPane 居中会把 1.5 吸附成 2、偏 0.5px
- [x] **拖拽排除列表** —— 原版 `SigmaMusicPlayer.vue:340` 的 `NO_DRAG_SELECTOR`
      （12 项）照抄成 `DragGate`，控件挂原版同名的 CSS class，
      按事件目标的父链判定（对应原版 `target.closest(...)`）
- [x] **贴边收起的半透明态 + 越界橡皮筋** —— 原版拖拽越过右缘时面板**先半透明**、
      松手才吸附。拖拽分两步（appServices.js:679-709）：先精确夹取不留余量，
      只有 `x+w > right+200`(var14) 且 `movedX > 70` 才进橡皮筋，
      `x = clampedX + (int)((desired-clampedX-200)*0.5)`；半透明判据
      `越界 && !已请求滑出`（MusicPlayer.java:360-361），淡到 50% 用 80ms、
      淡回 100% 用 150ms。吸附只发生在松手
- [x] 贴边收起的半透明态 + 越界橡皮筋 —— 原版拖拽越过右缘时面板**先半透明**、
      松手才吸附。拖拽分两步（appServices.js:679-709）：先精确夹取不留余量，
      只有 `x+w > right+200`(var14) 且 `movedX > 70` 才进橡皮筋，
      `x = clampedX + (int)((desired-clampedX-200)*0.5)`；半透明判据
      `越界 && !已请求滑出`（MusicPlayer.java:360-361），淡到 50% 用 80ms、
      淡回 100% 用 150ms。吸附只发生在松手
- [x] **dock 滑动曲线不一致** —— 原版是每帧 `0.25 × dt/18.10361` 插值（x 用 0.25、
      y 用 0.2）+ 120ms 触发节流 + 3s 卡死看门狗。之前是固定 450/125ms cubic ease-out，
      观感是「匀速起步再硬停」，与原版的指数逼近（滑到位才停）完全不同
- [x] **频谱参数接线** —— 之前是「死开关」：`Settings` 里定义了
      `spectrumScale` / `spectrumSigmaSmoothing` / `spectrumAvDelay` / `spectrumLocked`，
      但 `SpectrumView` 一个都不读，HUD 尺寸 220×60、48 频段、FFT 2048 写死。
      按 `src/views/SpectrumHUD.vue` + `PlayerEngine.vue` 整体重做后发现
      **原先的内核也是错的**，一并修掉：

  | 项 | 原先（错） | 现在（对齐原版） |
  |---|---|---|
  | FFT 长度 | 2048 | **1024**（`SPECTRUM_FFT_SIZE`） |
  | 频段数 | 48 个对数分箱 | **114** 直通 FFT bin（`SPECTRUM_BAR_COUNT`） |
  | 窗函数 | 加 Hann 窗 | **不加**（原版 `createSpectrumFft` 直接搬数组） |
  | PCM 量纲 | 除 32768 归一化到 -1..1 | **保留 Int16 原始量纲** |
  | 幅度 | 归一化到 0..1 | **不归一化**，上限 `2.256e7` |
  | 消费方式 | `toLogBands` 对数分箱 | `takeBins` 直取前 114 个 bin |

      - [x] `spectrumSigmaSmoothing` —— `tauMs = 1000/(smoothing*60)`，
            `alpha = 1-exp(-dt/tau)`，按 dt 步进所以任何刷新率下曲线一致
      - [x] `spectrumScale` —— `sigmaAmp = (1009/1080) * scale`，
            条高 `max(0, sqrt(levels)/12-5) * sigmaAmp`（原版实测游戏窗口 1920x1009）
      - [x] `spectrumAvDelay` —— 预读领先量，夹到 [0, 2000]，默认 590ms
      - [x] `spectrumLocked` —— 对应原版 `setIgnoreMouseEvents`。
            JavaFX 21 没有公开的鼠标穿透 API（`Scene` 上无 `setMouseTransparent`，
            `com.sun.javafx.tk.quantum.WindowUtils` 在 21 已移除），
            改用 JNA + Win32 `WS_EX_TRANSPARENT`（`system/MousePassthrough.java`）；
            双击切换解锁态，锁定时可拖窗口并记住位置
      - [x] sigmaQueue 爆发队列 —— 原版实测音频线程每 ~250ms 放行一批、
            一次推 9~10 帧（间隔直方图 0ms×453 / 250ms×59），
            所以观感是「保持 250ms → 整体前移 ~10 帧」的台阶。
            队列容量 4 帧（`SPECTRUM_SIGMA_QUEUE_MAX`）
      - [x] 暂停语义 —— 暂停清空队列 + 条形立即消失，恢复时首帧直接吸附不做渐变
      - [x] 频谱窗位置持久化（对应 `electron/appServices.js:165`、`main.js:459`）
      - [ ] **待验证**：真实播放时条高观感。离屏探针只能验公式与参数落地，
            实际条形高度要真机听一遍（`run.bat probe-play` 只验解码，不画频谱）
- [x] 播放模式持久化 —— 原版 `localStorage['player_playback_mode']`（`AppPrefs`，默认 1）
- [x] 拖拽排除列表 —— 原版 `SigmaMusicPlayer.vue:340` 的 `NO_DRAG_SELECTOR`
      （12 项）照抄成 `DragGate`，控件挂原版同名的 CSS class，
      按事件目标的父链判定（对应原版 `target.closest(...)`）

## C. 系统级（Electron 专属，Java 版无对应，暂不排期）

- [x] 托盘图标 + 托盘菜单 —— `system/TrayIconHelper.java` 走 AWT SystemTray，
      6 项操作（播放暂停 / 上一首 / 下一首 / 设置 / 显示隐藏面板 / 退出），
      原版是 9 项且用自定义 HTML 菜单窗，这里用系统原生菜单
- [ ] 其余 11 个全局快捷键（目前只有 RSHIFT）
- [ ] 任务栏缩略图工具条（上一首/播放暂停/下一首）、Jump List
- [ ] 桌面歌词窗、KeyStrokes HUD（WASD + 鼠标键覆盖层）
- [ ] 自动更新、单实例锁、`jello://` 协议、内置 api 子进程、WebSocket API 服务（6520）
- [x] 设置持久化：教程标记、登录态、播放模式、9 项设置、频谱窗位置
      （原版还有歌词窗位置大小与频谱窗尺寸，后者随窗口固定 220×60 未做）

## E. 打包

- [ ] **jpackage** —— `package.ps1` 写好了但从未跑通
      - [ ] 上次试跑在 `target/` 留了 1329 层自嵌套目录（已清），`.jimg/` 也还在
      - [ ] 跑通后验证 `JelloMusic.exe` 能启动、能出声
      - [ ] 注意 `package.ps1` 的去重逻辑会丢掉非 `-win` 的 javafx jar，
            任何新增依赖都不能依赖那个 jar

---

## 已完成（备查）

- 800×600 布局全部常量、左/右底板、贴边触发条
- 字形图集渲染（Logo / 歌名 / 歌手 / 时间 / 歌单项 / 缩略卡 / 搜索框）
- 歌名歌手跑马灯、搜索框自绘光标 + 横向滚动 + 三档 alpha
- 底部封面条（整图模糊 → 取底部 20% → 拉伸）
- 左栏歌单（猜你喜欢 / 每日推荐 / 我的歌单，含 sort 升序与过滤规则）
- 右栏结果网格（歌单卡下钻 / 歌曲卡整列替换队列 / 滚动区）
- 搜索（歌单卡在前、歌曲卡在后、去括号）
- 进度条四层、音量条三层 + 滚轮、循环按钮雪碧图裁剪
- 全局右 Shift 热键（GetAsyncKeyState 轮询，兼容游戏 Raw Input）
- 新手教程视图（键盘绑定选择器 + 强调 RSHIFT）