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
      - [x] **音质选择接进播放链路** —— 之前 `MainApp` 写死 `songUrl(hash, 320)`，
            设置项能改却不生效。新增 `api/QualityResolver.java`，
            1:1 复刻原版 `OnlineMusicQueue.js`（:1-200）：
            - `QUALITY_LEVELS` 7 档、默认 **128**（原版 defaultValue，不是 320）
            - 先问 `/privilege/lite` 拿这首歌实际有权限的档位（含 `relate_goods[]`）
            - 按 `getFallbackChain`（截到目标档再 reverse）**从高往低**依次试
            - 跳过 `extName == "mp4"`（JavaFX MediaPlayer 放不了，与原版同因）
            - 全失败时退化到 `free_part=1` 试听片段
            - `KuGouApiClient.songUrl` 加 String 重载（原版 quality 就是字符串，
              含 `flac / viper_*` 这些非数字档）
      - [x] **开机自启** —— 对应原版 `main.js:273-277` 的 `setLoginItemSettings`，
            即写 `HKCU\Software\...\CurrentVersion\Run`。见 `system/AutoStart.java`
      - [x] **界面缩放** —— 对应原版 `main.js:204-207` 的
            `force-device-scale-factor`，同样**只在启动时生效**（Electron 那两个
            switch 只能在 app ready 前设）。JavaFX 21 的 `Window` 没有 `setXScale`
            （只有 `setRenderScaleX`，那是 HiDPI 渲染比例不是布局缩放），
            所以缩场景根节点 + 放大 Stage 尺寸。见 `system/UiScale.java`
      - [x] 三个死开关全部接通，`probe-ui` 加 15 项断言钉住接线点
      - [ ] `全局快捷键` 仍是占位（ACTION 但无实现）
      - [ ] `响度标准化` / `数据源` 没做——依赖 Web Audio 的
            DynamicsCompressor / 节点切换，Java 侧要另找实现

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
- [x] **dock 滑动曲线不一致** —— 原版是每帧 `0.25 × dt/18.10361` 插值（x 用 0.25、
      y 用 0.2）+ 120ms 触发节流 + 3s 卡死看门狗。之前是固定 450/125ms cubic ease-out，
      观感是「匀速起步再硬停」，与原版的指数逼近（滑到位才停）完全不同
- [x] **右侧弹出 / 贴边收起与 sigmarebase 逐值核对一致** ——
      `updatePanelDimensions`（:199-257）的两个目标位置都已对齐：
      - 收起 `var8 = parentWidth - 40` → `Theme.DOCK_VISIBLE = 40`
      - 展开 `var11 = parentWidth - 20 - width` → `Theme.RESTORE_MARGIN = 20`
      - 收敛判据 `|x-target| < 2.0F` → `EdgeDock` 的 `ANIM_EPSILON`
      - 橡皮筋 `x += (var12 - x - 200) * 0.5F` → `RUBBER_BAND_ALLOWANCE = 200`
      本轮核对**无需改动**，原有实现已经是对的
- [x] **左右底板分色与 sigmarebase 逐值核对一致** ——
      `draw`（:287-300）两块底板：
      - 左栏 `-16777216`（纯黑）× alpha `partialTicks*0.95`
      - 右栏 `-14277082`（= `#262626`）× alpha `partialTicks*0.8`
      现有 `Theme.LEFT_PANEL` / `RIGHT_PANEL` 就是这两个值，本轮核对**无需改动**
- [x] **右栏顶部模糊标题栏** —— `method13196`（:474-533），之前完全没有：
      - 高度 64（`field20847`）
      - 模糊底：`glReadPixels` 截屏 → 10×10 降采样 → 补 10px DEEP_TEAL 边 →
        `applyBlur(·, 10)`。Java 拿不到屏幕缓冲区，**保留处理链**（降采样 → 补边 →
        模糊），像素来源换成右栏底色，见 `ui/RightTitleBar.blurredBackdrop`
      - 滚动淡入：`offset < 50 ? offset/50 : 1`（线性）
      - 叠 20% 浅色
      - 标题两层交叉淡入，y = `16 + (1-v)*14`（淡入时从 30 滑到 16）
      - 底部 20px 阴影（mod 用 `shadowBottomPNG`，Java 用线性渐变等价表达）
- [x] **频谱参数接线** —— 之前是「死开关」：`Settings` 里定义了
      `spectrumScale` / `spectrumSigmaSmoothing` / `spectrumAvDelay` / `spectrumLocked`，
      但 `SpectrumView` 一个都不读，HUD 尺寸 220×60、48 频段、FFT 2048 写死。
      整体重做后发现**原先的内核也是错的**，一并修掉。

      > **对齐基准（2026-09-12 确认）**：以 `C:\Users\xu171\IdeaProjects\sigmarebase`
      > 的 `MusicManager.renderSpectrum()` 为权威，**不是** Electron 版。
      > 两者参数不同（PCM 量纲 / 平滑公式 / 队列长度），下次动内核前先确认对齐哪边。

  | 项 | 原先（错） | 现在（对齐 sigmarebase） | 出处 |
  |---|---|---|---|
  | FFT 长度 | 2048 | **1152**（一个 MP3 帧的采样数） | `MusicManager:398` |
  | 频段数 | 48 个对数分箱 | **114** 直通 bin | `renderSpectrum:172` |
  | 窗函数 | 加 Hann 窗 | **不加** | `JavaFFT:48-53` |
  | PCM 量纲 | 保留 Int16 | **除 32768 → -1..1** | `MathHelper:21-30` |
  | 幅度 | 归一化到 0..1 | **不归一化**，上限 `2.256e7` | `onRender2D:149` |
  | 队列上限 | 4（Electron 值） | **18** | `MusicManager:405` |
  | 平滑 | τ 指数步进 | `alpha = 0.335*(60/实际FPS)` 插值 | `onRender2D:144-151` |
  | 消费方式 | `toLogBands` 分箱 | `takeBins` 直取 | `calculateAmplitudes:32-41` |

      - [x] `spectrumSigmaSmoothing` —— `alpha = min(smoothing * (60/实际FPS), 1)`。
            Java 侧没有 `Minecraft.getFps()`，用画布实测帧率代替
      - [x] `spectrumScale` —— `(参考窗口高/1080) * scale`，
            条高 `max(0, sqrt(a)/12-5) * heightRatio`
      - [x] `spectrumAvDelay` —— 预读领先量，夹到 [0, 2000]，默认 590ms
      - [x] `spectrumLocked` —— 对应原版 `setIgnoreMouseEvents`。
            JavaFX 21 没有公开的鼠标穿透 API（`Scene` 上无 `setMouseTransparent`，
            `com.sun.javafx.tk.quantum.WindowUtils` 在 21 已移除），
            改用 JNA + Win32 `WS_EX_TRANSPARENT`（`system/MousePassthrough.java`）；
            双击切换解锁态，锁定时可拖窗口并记住位置
      - [x] 暂停语义 —— 对应 `while(!playing){ sleep(300); visualizerData.clear(); }`，
            是「最多 300ms 内清空」而非立即清；恢复播放时首帧吸附不做渐变
      - [x] 频谱窗位置持久化（对应 `electron/appServices.js:165`、`main.js:459`）
      - [x] **条形内叠加模糊封面** —— 原版走 OpenGL stencil
            （`initStencilBuffer` → `configureStencilTest` → `drawImage(..., 0.4)`），
            JavaFX 无 stencil，改成「逐条按条形区域绘制」
      - [x] **左下角信息块** —— 100x100 圆角封面（圆角 14、描边 alpha 0.3）+ 歌名，
            歌名两层叠出描边（深青 0.5 + 浅色 0.7）。
            封面随低频缩放：`1 + round(peak/3750 * 0.14 * 75)/75`，取前 3 个频段，
            钳在 1.14；锚点 (60, H-55) 而非封面中心。
            见 `ui/SpectrumInfoBlock.java` 与 `SpectrumView.coverScale`
      - [x] 频谱窗尺寸 220×60 → **420×130** —— 220x60 装不下 100x100 的信息块
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
- [x] **单实例锁** —— 对应 `electron/main.js:105-133` 的
      `requestSingleInstanceLock` + `second-instance`。见 `system/SingleInstance.java`：
      - Java 没有互斥体 API，用 `FileLock`（OS 文件句柄支撑，进程退出自动释放，
        不像 pid 文件那样崩溃后留僵尸锁）
      - 拿不到锁 → 给已有实例写唤醒信号后退出（`MainApp.main` 里在 `launch()` **之前**判断，
        否则窗口会闪一下）
      - 唤醒动作：贴边收起时先 `expandDock()` 再 `toFront`，
        对应原版「restore 后把 Sigma 窗口提到最前」
      - 坑：同一 JVM 内重复 `tryLock()` 抛 `OverlappingFileLockException` 而非返回 null；
        Windows 上持有 `FileLock` 的文件不允许另一个通道读，所以 pid 要记在内存里
- [ ] 自动更新、`jello://` 协议、内置 api 子进程、WebSocket API 服务（6520）
- [x] 设置持久化：教程标记、登录态、播放模式、9 项设置、频谱窗位置
      （原版还有歌词窗位置大小与频谱窗尺寸，后者随窗口固定 220×60 未做）

## E. 打包

- [x] **jpackage** —— 跑通了。`powershell -File package.ps1` → `pkgout\JelloMusic\JelloMusic.exe`
      （103.9 MB，含私有 runtime）。实测 exe 能启动、JavaFX 初始化成功、
      稳定存活 14s+、stderr 无异常（只有「API 未启动」的正常提示）

      卡了很久，四个真正的坑（脚本头部有完整记录）：

  | # | 现象 | 真因 | 解法 |
  |---|---|---|---|
  | 1 | `FileAlreadyExistsException: app\mods`，删任何单个依赖都无效 | javafx 同时在 runtime image 和 `--module-path` 里 | **拆成两条 module path**：jlink 拿 app+javafx，jpackage 的 `--input` 只放自动模块 jar |
  | 2 | `automatic module cannot be read: jlayer` | 自动模块不能当 jlink 根（JDK-8305967），`--bind-services` 也没用 | jlayer/jna/slf4j **不进镜像**，运行时从 `app\` 提供 |
  | 3 | `FindException: Module java.logging not found` | jackson-databind 声明了 `requires java.logging`，jlink 漏了 | `--add-modules` 补 `java.logging/management/naming/sql/jdk.crypto.ec` |
  | 4 | cfg 是 classpath 模式，JavaFX 拒绝启动 | jpackage 只发 classpath launcher，本项目是模块化的 | 打包后重写 cfg 为 `--module-path=` + `--module=`；**用 `=` 不能用空格、不加引号**（引号会被当路径字符） |

      - [x] `--input` 下的 jar 必须在**根目录**，放进 `app\` 子目录 jpackage 会拒绝
      - [x] PowerShell 的 `--add-modules` 不能用反引号续行（逗号后换行会被当数组拆开）
      - [x] 产物目录已 gitignore：`.jimg/`、`pkgout/`、`mp.txt`、`mp-pkg.txt`、`tools/`
      - [ ] 打包产物里 `run.bat` 的自动起 API 逻辑用不上（那是开发用的），
            所以 exe 需要先在仓库根目录 `npm run api`
      - [ ] 未做：安装包（.msi / exe setup），需要 WiX，本机没装
      - [ ] 未做：代码签名（Windows SmartScreen 会拦未签名 exe）

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