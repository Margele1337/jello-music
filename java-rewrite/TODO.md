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
- [x] **淡入淡出改为与 mod 同源的进度连续动画** —— 对齐
      `MusicPlayer:275-278` 的 `field20873`（`Animation(80, 150, BACKWARDS)`）：
      - alpha 公式 `0.5 + (1 - p) * 0.5`，`p = calcPercent()`。
        **alpha 与 p 的绑定跟方向无关**：p=1 → 0.5 半透明，p=0 → 1.0 不透明。
        之前把方向也算进去了，公式反了，是靠 `DockMotionProbe` 实测看出来的
      - `changeDirection` 用<b>当前进度反推新起点</b>（`Animation.java:50-58`），
        来回连按 RSHIFT 时进度连续不跳变。之前是「切状态就重启动画」，
        连按会重新从头播
      - 实测：收起稳态 alpha=0.500，淡入 0.500→0.616→0.719→0.825→0.932→1.000
        严格线性，162ms 到位（权威 150ms，差值是 30ms 采样粒度）；
        x 从 1880 指数收敛到 1100，450ms 到位
- [x] **触发条按「越界」而非「吸附态」显示** —— 对齐 `MusicPlayer:275`
      `field20865.setWidthA(越界 ? 41 : 0)`。吸附态是用户操作触发的离散事件，
      越界是每帧连续判定；差在拖拽滑出途中——那时还没吸附，
      但 mod 此时已经把触发条显示出来了。见 `PlayerPanel.setDockTriggerVisible`
- [x] 点击 41px 触发条恢复展开（`EdgeDock.expand()` 清 snapped +
      `undockRequested=true` + 滑出）
- [x] **展开缩放对齐 `alphaFactor` 三分支与双缓动** —— `ClickGuiScreen.draw:255-257,292`：
      - `alphaFactor = (完成 && !已开始) ? method13317(p,0.8)*0.5+0.5
        : (!完成 ? 1.0 : method13317(p,1.0))`
      - 关键在 `method13317`（`:247-251`）**按方向选缓动**：BACKWARDS（展开）走
        `easeOutQuad`，FORWARDS（收起）才走 `easeOutElastic`。
        之前 Java 版无条件用 elastic，展开时曲线是错的
      - 实测曲线：`scale` 1.25 →（过冲 0.9831）→ 0.9945 → 1.0013 → 1.0。
        中途那个来回就是「弹进来」的手感，`easeOutQuad` 单调、不会有这个效果
- [x] `run.bat probe-dock` / `probe-spectrum` 两个子命令，
      改动画或频谱时能随手验

### 拖拽机制：有意与 mod 不同

mod（`AnimatedIconPanel:95-115`）与 Java 版（`EdgeDock`）的拖拽触发方式不同：

| | mod | Java 版 |
|---|---|---|
| 进入「被拖动」 | 按住后计时 >=300ms（`field20888`）或鼠标移动 >2px（`field20889`） | 鼠标按下即进入 |
| 边界处理 | 由 `updatePanelDimensions` 的 0.25/0.2 插值把面板拉向目标 | 拖拽中实时做橡皮筋（越界 200px 且 `movedX > 70` 才进） |
| 观感 | 「按住 → 吸附过去」 | 「拖拽中带阻尼」 |

Java 版跟的是 **Electron 版**（`appServices.js:679-709`，明确是拖拽中橡皮筋），
不是 mod——因为本项目就是 Electron 版的移植。
**记录在此以免下次误判成「没对齐 mod」。**
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
  | FFT 长度 | 2048 | **1024**（必须是 2 的幂，见下） | `JavaFFT` |
  | 频段数 | 48 个对数分箱 | **114** 直通 bin | `renderSpectrum:172` |
  | 窗函数 | 加 Hann 窗 | **不加** | `JavaFFT:48-53` |
  | PCM 量纲 | 保留 Int16 | **L+R 打包成 int32，`&0xFF` 无符号** | `MathHelper:21-30` |
  | 幅度 | 归一化到 0..1 | **不归一化**，上限 `2.256e7` | `onRender2D:149` |
  | 队列上限 | 4（Electron 值） | **18** | `MusicManager:405` |
  | 平滑 | τ 指数步进 | `alpha = 0.335*(60/实际FPS)` 插值 | `onRender2D:144-151` |

      > ⚠️ **PCM 量纲是最隐蔽的坑**：mod 按 `audioFormat.getFrameSize()` 逐帧取字节，
      > 16bit 立体声的 frameSize = 4，即**一个「采样点」= L 的 2 字节 + R 的 2 字节**，
      > 再经 `bytesToIntLE`（`:43-53`）以 `& 0xFF` 无符号累加。于是
      > ①负数变大正数 ②**两声道塞进同一个 int32**（高 16 位 R、低 16 位 L）。
      > 按「short 除 32768」的直觉写，实测 1024 点满幅正弦的 `|X(1)|` 只有约 12，
      > 而条高门槛是 `a > 3600` ——**所有条形恒为 0，频谱窗一条都不显示**，
      > 偏偏所有公式断言都是绿的。只有真接音频跑一遍才暴露。

      > ⚠️ **FFT 长度**：mod 写 `new JavaFFT(1152)`，但 1152 = 128×9 不是 2 的幂，
      > 而 mod 的 `JavaFFT.transform`（:89）同样是 `blockSize <<= 1`
      > ——**那条路在 mod 里也跑不通**。取 1024。

      - [x] **高度比基准实测标定** —— mod 画在 1080p 全游戏窗口
            （`heightRatio = 1.0`，最满条约 220px = 全窗 20%）；
            但本项目频谱窗只有 420×130，扣掉信息块只剩约 108px 可用，
            沿用 1080 会让 1.0x 顶满甚至溢出（实测 207px vs 108px = 192%）。
            标定为 `REFERENCE_HEIGHT = 290`，使 1.0x 约占四成、
            `spectrumScale` 的 0.2~3 正好覆盖「贴地 ~ 顶满」
  | 消费方式 | `toLogBands` 分箱 | `takeBins` 直取 | `calculateAmplitudes:32-41` |

      - [x] `spectrumSigmaSmoothing` —— `alpha = min(smoothing * (60/实际FPS), 1)`。
            Java 侧没有 `Minecraft.getFps()`，用画布实测帧率代替
      - [x] `spectrumScale` —— `(参考窗口高/1080) * scale`，
            条高 `max(0, sqrt(a)/12-5) * heightRatio`
      - [x] `spectrumLocked` —— 对应原版 `setIgnoreMouseEvents`。
            JavaFX 21 没有公开的鼠标穿透 API（`Scene` 上无 `setMouseTransparent`，
            `com.sun.javafx.tk.quantum.WindowUtils` 在 21 已移除），
            改用 JNA + Win32 `WS_EX_TRANSPARENT`（`system/MousePassthrough.java`）；
            双击切换解锁态，锁定时可拖窗口并记住位置
      - [x] `spectrumAvDelay` —— 预读领先量，夹到 [0, 2000]，默认 590ms。
            **这是第四个死开关，本轮才真正接上**：
            之前只 `setLeadSeconds` 存着，没人消费。
            现在 1:1 复刻原版 `syncLookahead`（`AudioController.js:106-124`）：
            `expected = 播放位置 + lead`，偏差 > 80ms 就重新定位。
            差别在「怎么跳」——原版给真实 Audio 设 `currentTime` 由浏览器 seek，
            Java 侧是自己拉流，所以改成按字节偏移重开 Range 请求。
            实现见 `SpectrumTap.seekToSeconds` 与 `SpectrumFeed.realignToPlayback`
      - [x] **频谱窗开关持久化** —— 对应原版 `desktopSpectrum`（`settings.js:46-57`，
            默认 off）。之前只切窗口显示，重启后不记得开没开过
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
- [x] **真实音频端到端验证** —— 新增 `tools/SpectrumProbe`：真连 api、真拉直链、
      真解 60 帧、按公式平滑、渲染截图并打印幅度统计。
      实测发现并修掉了两个只有真跑才暴露的问题（PCM 量纲差 6万倍导致条高恒为 0、
      高度比基准导致 1.0x 顶满溢出）。当前 1.0x 约占可用高度四成、形态正确
      （左高右低的高频衰减），截图见 `%TEMP%\spectrum-scale-*.png`

### 频谱 seek 的三个坑（按字节跳音频流）

`spectrumAvDelay` 要真生效就得能按时间跳，实测踩了三层：

| 坑 | 现象 | 解法 |
|---|---|---|
| FFT 长度不是 2 的幂 | 上轮把 `FFT_SIZE` 改成 1152（一个 MP3 帧的采样数），`Fft` 构造直接抛 `IllegalArgumentException`，**真实播放会当场崩** | 改回 1024。1152=128×9 不是 2 的幂，而 mod 的 `JavaFFT.transform` 同样是 `blockSize <<= 1`，**那条路在 mod 里其实也跑不通** |
| 跳到帧中间解不出 | 按估算字节偏移跳到 20s，后续 500 次解码全返回 null | 扫 MP3 同步字（`0xFF` + 次字节高 3 位 `0xE0`），命中后 pushback 回流头再试解一帧确认 |
| 跳完第一轮只解出 10 帧 | 对齐探测消耗了开头几帧，且 `Bitstream` 解完第一帧才进稳态 | seek 后预热解 12 帧（`WARMUP_FRAMES`） |

另外 MP3 是变比特率，字节与时间不严格线性：按前 64KB 的实际解码结果估平均码率
（`bytesPerSecond`），误差累积后靠 `realignToPlayback` 的周期性校正兜住。
`realignToPlayback` **只往后跳不往回跳**——已解出的帧不能「撤销」，
强行回到过去只会把顺序解码打乱。
- [x] 播放模式持久化 —— 原版 `localStorage['player_playback_mode']`（`AppPrefs`，默认 1）
- [x] 拖拽排除列表 —— 原版 `SigmaMusicPlayer.vue:340` 的 `NO_DRAG_SELECTOR`
      （12 项）照抄成 `DragGate`，控件挂原版同名的 CSS class，
      按事件目标的父链判定（对应原版 `target.closest(...)`）

## C. 系统级（Electron 专属，Java 版无对应，暂不排期）

- [x] 托盘图标 + 托盘菜单 —— `system/TrayIconHelper.java` 走 AWT SystemTray，
      6 项操作（播放暂停 / 上一首 / 下一首 / 设置 / 显示隐藏面板 / 退出），
      原版是 9 项且用自定义 HTML 菜单窗，这里用系统原生菜单
- [ ] 其余 11 个全局快捷键 —— **按用户要求只保留 RSHIFT**
- [x] **系统媒体键** —— 对应原版 `MediaSession.js`。原版用浏览器
      `navigator.mediaSession`，Java 侧没有；改走 Win32 键盘虚拟键
      （`VK_MEDIA_PLAY_PAUSE/STOP/NEXT_TRACK/PREV_TRACK`）+ `GetAsyncKeyState`
      轮询（与 RSHIFT 同理，游戏 Raw Input 下钩子收不到、轮询照样有效）。
      见 `system/MediaKeyPoller.java`。
      **代价**：键盘能控播放，但系统音量面板/通知栏里看不到曲名与进度——
      那需要 SMTC（WinRT COM），JNA 手搓 vtable 且跨 Windows 版本不稳定
- [x] **`jello://` 协议** —— 对应原版 `appServices.js:1481-1545`。
      Electron 一句 `setAsDefaultProtocolClient` 搞定，Java 改写注册表
      `HKCU\Software\Classes\jello`（含 `URL Protocol` 与
      `shell\open\command`）。见 `system/JelloProtocol.java`
- [x] **对外控制服务（WS API）** —— 对应原版 `apiService.js`
      （`ws://127.0.0.1:6520`）。Java 无内置 WebSocket，手写 RFC 6455
      服务端最小子集（握手 SHA-1+base64、文本帧、客户端掩码解码、ping/pong/close）。
      命令集与原版一致：`toggle` / `next` / `prev`；连上先收 `welcome` +
      `playerState`，播放状态变化时主动推 `playerState`。
      歌词推送那一路**刻意不做**（本项目不做歌词）。见 `system/WsApiServer.java`
- [x] **桌面快捷方式** —— 原版 `desktopShortcutIcon.js` 只「更新已存在的」
      不主动创建；这里在 `package.ps1` 打包后自动创建带图标的快捷方式
- [ ] 自动更新（需要发布服务器与签名，本项目没有）
- [ ] 内置 api 子进程（当前靠 `run.bat` / `npm run api`）
- [x] **Jump List** —— 对应 `electron/main.js:85-99` 的 `setupJumpList`：
      - `AppUserModelID = cn.jello.music`（通过 `shell32` 的
        `SetCurrentProcessExplicitAppUserModelID`，必须在建窗口之前调，
        否则任务栏会用 `java.exe` 的身份，分组与 Jump List 全乱）
      - `--settings` 启动参数 → 直接进设置页（教程期间会挂起，
        教程完成后补上，因为此时 Sigma 窗口才刚显示）
      - 那条「设置」任务没做成运行时注册（见下）
      - **修正**：此前误记「原版没有缩略图工具条」——那次 grep 用了
        `ThumbnailToolbar`（拼写不对）所以没命中就下了结论。
        原版确有 `setThumbarButtons`，见上
- [x] **最小化到托盘** —— 原版 `appServices.js:112-124`：
      `if (minimizeToTray === 'off') quit(); event.preventDefault(); hide();`
      默认 **on**。之前 Java 版关窗口直接退，等于这个开关一直是 off。
      现在 `setOnCloseRequest` 里 consume + 藏起所有窗口（Sigma / 频谱 / 设置页），
      真正的退出走托盘菜单的「退出」。
      注意 JavaFX 透明窗不能最小化，所以「收进托盘」就是 `Stage.hide()`
- [x] **阻止休眠** —— 原版 `main.js:200` 的
      `powerSaveBlocker.start('prevent-display-sleep')`。
      Java 侧走 Win32 `SetThreadExecutionState(ES_CONTINUOUS|ES_DISPLAY_REQUIRED|
      ES_SYSTEM_REQUIRED)`，恢复时只留 `ES_CONTINUOUS`。
      **该 API 是 thread-local 的**，必须在 FX 线程调用，见 `system/KeepAwake.java`
- [x] **托盘「显示/隐藏面板」修 bug** —— 原来直接调 `toggleDock`（贴边收起），
      但「收进托盘」是 `Stage.hide()`。从托盘点「显示」会去操作一个已经隐藏的窗口：
      既唤不回来，贴边状态也被弄乱。现在按 `sigmaStage.isShowing()` 分流，
      并记住收进托盘前频谱窗的状态以便一并恢复
- [ ] **自定义托盘菜单** —— 原版 `customTrayMenuService.js` 377 行可自定义项；
      当前 Java 是固定 6 项原生菜单
- [ ] **自定义 API 地址** —— `apiBaseUrl` / `apiBaseUrlMode`；
      `KuGouApiClient` 已有 `base` 构造参数，只差设置项与接线
- [ ] **任务栏缩略图工具条** —— 原版 `appServices.js:1433` `setThumbarButtons`
      （上一首 / 播放暂停 / 下一首，播放中切换 play-pause 图标）。
      走 Win32 `ITaskbarList3` COM，JNA 要手工排布 vtable 且跨 Windows 版本不稳定，
      风险明显高于其它项，建议放最后
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