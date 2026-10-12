# Jello Music · Java 重写

把 Electron + Vue + Node 的桌面客户端重写为 Java 版本。目标：业务逻辑全部可只用 Java 读写与调试。

许可：沿用原项目的 **GPL-2.0-only**，保留版权声明。

## 环境前提（本机实测）

| 项 | 状态 |
|---|---|
| JDK | Zulu 21.0.12 |
| Maven | 需自备（见下） |
| Maven Central (`repo1.maven.org`) | **不可达**，必须走镜像 |
| 阿里云 Maven 镜像 | 可用，含 `javafx-*` / `jlayer` / `jackson` |

因此本目录带了一个 `settings.xml`，把所有仓库指向阿里云。构建命令一律带上它：

```powershell
mvn -s settings.xml clean compile
```

Maven 本体可从 `archive.apache.org` 下载（本机可达）：

```powershell
Invoke-WebRequest https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip -OutFile maven.zip
Expand-Archive maven.zip -DestinationPath tools
```

## 运行

最简单的方式：

```bat
run.bat
```

`run.bat` 会自动找 Maven（优先 PATH，其次 `tools\apache-maven-3.9.9\`）、编译、解析依赖并以 module path 启动 GUI。

```bat
run.bat                  :: build + 确保 api 在跑 + 启动 GUI
run.bat probe            :: 只跑无窗口的链路探针
run.bat probe-ui         :: 静默 UI 校验（不弹窗不抢焦点，打游戏时可跑）
run.bat probe-play       :: 静音播放链路实测
run.bat <直链URL>         :: 指定音频直链
run.bat api              :: 前台跑 KuGou API（排查用）
run.bat api-stop         :: 杀掉占用 API 端口的进程
```

**API 自动起停**：`run.bat` 会拉起仓库根目录的 KuGou API
（`node api/app.js --platform=lite --port=6521`），端口没人监听时才起、退出时收掉；
你自己起的 API 不会被动。日志在 `%TEMP%\jello-api.log`；`api/` 缺失时提示
`git submodule update --init`。

> 这里刻意**没有用 PowerShell**：`powershell.exe -Command` 从 .bat 里调起在这台机器上
> 会返回「拒绝访问」（exit 5），只有 `-File` 能用。探端口与查 PID 改用 `netstat`，
> 等待用 `ping -n 2`（`timeout` 在 stdin 被重定向时会直接失败）。

Maven 本体需自行下载放到 `tools\`（该目录已 gitignore）：

```powershell
Invoke-WebRequest https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip -OutFile maven.zip
Expand-Archive maven.zip -DestinationPath tools
```

凭据走环境变量，避免 token 进命令行历史：

```powershell
set JELLO_TOKEN=xxx
set JELLO_USERID=xxx
set JELLO_DFID=xxx
set JELLO_HASH=歌曲hash
```

## 交互

| 操作 | 行为 |
|---|---|
| 拖动面板 | 移动窗口 |
| 拖到屏幕最右侧 | 自动贴边收起（露出 40px） |
| 右 Shift（全局） | 收起 / 展开，1:1 复刻原版 `globalKeyService.js` |
| 左栏「猜你喜欢」 | 打乱后直接进队列播放，右栏保持空白 |
| 左栏「每日推荐」 | `/everyday/recommend` 翻两页取 60 首，不够用「猜你喜欢」去重补足，铺到右栏 |
| 左栏歌单 | 该歌单曲目铺到右栏 |
| 右栏歌单卡（青色） | 下钻该歌单 |
| 右栏歌曲卡 | 用当前整列替换队列并播放这首 |
| 搜索结果区 | 滚轮上下翻，滚动条按原版隐藏 |
| 频谱 | 后台线程拉流解码 + FFT，实时绘制 |

> Java 端依赖本地 KuGou API：先在仓库根目录 `npm run api`（端口 6521），
> 凭据走 `JELLO_TOKEN` / `JELLO_USERID` / `JELLO_DFID` 环境变量。
> api 没起来时左栏仍会显示「猜你喜欢 / 每日推荐」，其余报错只写 stderr（不占面板像素）。

## 当前已跑通的部分

`tools/PipelineProbe` 是一个不拉起窗口的端到端探针，覆盖三段：

1. **api 连通性** — `KuGouApiClient` 用 `HttpClient` 直连本地 `KuGouMusicApi`（`http://127.0.0.1:6521`）
2. **取音频直链** — `/song/url`，凭据按原前端 `src/utils/request.js` 的规则拼 `Authorization` 头
3. **解码 + 频谱** — 拉直链 → JLayer 解 MP3 → `Fft` 变换 → 对数分箱

实测输出（真实歌曲）：

```
[1] 调用 /privilege/lite            成功  error_code=0
[2] 调用 /song/url                  直链 http://fs.youthandroid2.kugou.com/.../qu320_..._.mp3
[3] 拉流解码并计算 FFT
    采样率=44100 Hz  声道=2  帧长=1024
    连续解码帧数=20
    24 频段: 0.00 0.00 0.00 0.00 0.01 0.01 0.03 0.10 0.58 0.06 0.04 0.11 0.10 0.08 ... 0.00
```

## 已验证的关键结论

- **酷狗音频是 HTTP 直链播放，不是本地 KGM 加密文件** — `PlayerEngine.vue` 里就是 `audio.src = song.url`，全仓无任何解密逻辑。所以 Java 端**不需要写音频解密**。
- **直链不校验 UA / Referer** — 三组请求头（空 / 带 Referer+UA / 仅 Referer）全部返回 HTTP 206 + `audio/mpeg`。这一点很关键，因为 JavaFX `MediaPlayer` **无法设置任何请求头**，若直链校验头则 JavaFX 路线直接不通。
- **直链支持 HTTP Range（206）** — 可以只拉前若干 MB 做频谱分析，不必整首下载。
- **api 会用 HTTP 502 携带 `status=1` 的正常载荷**，且响应体外层包着 `<!--KG_TAG_RES_START-->` 注释标记。所以不能按状态码判成败，`KuGouApiClient.parseApiResponse` 一律以 JSON 内容为准。
- **本机装了 HTTP 代理**，`HttpClient` 不显式设置 `NO_PROXY` 会让所有本地请求拿到 502。

## 关于"复用 sigmarebase"

sigmarebase 是 Minecraft 客户端模组，它的音乐播放器 UI 依赖 `glScalef`、`ClickGuiScreen.draw()`、Minecraft 字体/输入/资源管理器以及 OpenGL 上下文（由游戏主循环提供）。**这些代码离开 Minecraft 无法编译运行**，不存在"复制到桌面应用直接用"的路径。

可复用的是**算法与实测常量**，已按此方式在 Java 侧重新实现：

| 来源 | Java 实现 |
|---|---|
| `easeOutElastic(p, period=0.8)` | `Fft` 无关；动画曲线在后续 `ui/` 中按同参数实现 |
| `SIGMA_DOCK_VISIBLE = 40` | 后续 `ui/` 中沿用 |
| `SIGMA_RESTORE_MARGIN = 20` | 后续 `ui/` 中沿用 |
| 拖拽夹取与橡皮筋判定 | 后续 `ui/` 中按同规则重新实现 |
| FFT 幅度补偿 | `SpectrumTap.toLogBands` |

原 Electron 版里这些推导过程记录在 `electron/appServices.js` 的注释里，可作为实现依据。

## 频谱：以 sigmarebase 为准，不是以 Electron 版为准

频谱是本项目里最容易写错的一块，因为它有**两份互相打架的参考实现**：

| 参考 | 位置 | 本项目怎么用 |
|---|---|---|
| **sigmarebase（权威）** | `C:\Users\xu171\IdeaProjects\sigmarebase` → `MusicManager.renderSpectrum()` | **内核按它做** |
| Electron 版 | `src/views/SpectrumHUD.vue` + `PlayerEngine.vue` | 面板布局、设置项沿用它 |

两者参数**不一样**：PCM 量纲、平滑公式、队列长度都不同。
既然目标是移植 Electron 版，本该以 Electron 版为准；但用户明确要求「按 sigmarebase 改」，
所以内核改成了 sigmarebase 的定义。**下次再动频谱内核前，先确认对齐哪一边。**

sigmarebase 的权威链路（`MusicManager.java` 行号）：

```
PCM 字节 → convertToPCMFloatArray (MathHelper:21-30)   sample / 32768.0f  → -1..1
        → new JavaFFT(len).transform() (JavaFFT:48-53)  不加窗
        → calculateAmplitudes (MathHelper:32-41)        sqrt(re²+im²)，长度 len/2
        → visualizerData 队列 (MusicManager:398-407)    上限 18，超了 remove(0)
        → onRender2D (MusicManager:144-151) 平滑
             fps = 60 / Minecraft.getFps()
             alpha = min(smoothing * fps, 1)            // smoothing 默认 0.335F
             a[i] = clamp(a[i] - (a[i]-target)*alpha, 0, 2.256e7)
        → renderSpectrum (MusicManager:171-240) 绘制
             height = max(0, sqrt(a[i])/12 - 5) * (窗口高/1080)   绝对像素
             底条 alpha = 0.2 * (1 - (i+1)/114)
             再 stencil 叠加 songThumbnail，alpha 0.4
             左下角信息块：100x100 圆角封面 + 歌名
               封面缩放 = 1 + round(peak/3750 * 0.14 * 75)/75，peak 取前 3 个频段
               缩放锚点 (60, H-55)，不是封面中心
```

### 踩过的坑

- **PCM 量纲**：sigmarebase 除 32768，Electron 的 `spectrumTapProcessor` 不除（Int16Array）。
  别被 Electron 版带偏——那是它为对齐 sigmarebase 自己补的一层近似。
- **平滑公式**：sigmarebase 是 `alpha = 0.335 * (60/实际FPS)` 的插值；
  Electron 版换算成 `τ = 1/(smoothing*60)` 的指数步进。两者在不同帧率下曲线接近，
  但不是同一个表达式。
- **坐标方向**：sigmarebase 的 y 是 `H - 偏移`（原点在左上、y 向下）；
  JavaFX 原点在左下、y 向上，所以 `H - offset` **直接就是** JavaFX 的 y，
  **不能再取负**。写成 `-offset` 会把封面甩到窗口外——这个 bug 是被 `probe-ui`
  的「缩放后仍在窗内」断言抓到的，肉眼看截图只会觉得「封面不见了」。
- **`Parent.layout()` 和 `Region.layoutChildren()` 都是 final**，不能覆写。
  要按自定义规则摆子节点，只能监听 `width/heightProperty` 后手动 `resizeRelocate`。

### 鼠标穿透：JavaFX 没有这个开关

`spectrumLocked` 对应原版的 `set-spectrum-ignore-mouse-events` IPC。
JavaFX 21 **没有公开的鼠标穿透 API**——`Scene` 上不存在 `setMouseTransparent`，
`com.sun.javafx.tk.quantum.WindowUtils`（当年拿 HWND 用的）在 21 已被移除，
只剩包私有的 `WindowStage.getRawHandle()`。

所以 `system/MousePassthrough.java` 反射取原生句柄，再用 JNA 设
`WS_EX_TRANSPARENT`——这正是 Electron 内部做的事，语义一致（点击落到下层窗口）。
取不到句柄时不抛异常，退化成「不穿透」，不影响播放与绘制。
## 改完 UI 自己看一眼

`probe-ui` 会额外把**新手教程页按全屏尺寸**渲染成
`%TEMP%\jello-ui-probe-onboarding.png`（原来只截 800x600 的主面板）。

起因是有一次「看着明显不对」的 bug 探针全绿就放过去了：教程页单独开全屏窗时，
视图还按 `Theme.PANEL_W/PANEL_H` 构造，`setClip(800x600)` 把整页裁成左上角一块，
键盘缺一大半——属性断言全对，肉眼一看就废。所以新增了「铺满窗口 / 裁剪框覆盖 /
键盘完整落在窗口内 / 标题居中 / 底部一行在窗口内」这几条断言。

规则：**改了视图层就截图自己看**，别只看断言。

## JLayer 1.0.1 的 API 陷阱

它的 API 与 1.0.2+ 不同，照新版教程写会连续报错。已踩的坑：

- `new Decoder()` 是**无参**构造，先 `setOutputBuffer(SampleBuffer)`
- 每帧 `bitstream.readFrame()` 拿 `Header`，再 `decodeFrame(header, bitstream)`
- **必须调用 `bitstream.closeFrame()`** —— `decodeFrame` 依赖它把输入流推进到下一帧起点。漏掉的话流位置不动，每次都读到同一帧，频谱恒为全零
- 清空输出用 `clear_buffer()`，没有 `reset()`
- `Header` 没有 `getSampleRate()` / `getChannels()`，用 `frequency()` 与 `SampleBuffer.getChannelCount()`
- `OBUFFERSIZE` / `MAXCHANNELS` 挂在 `Obuffer` 上，不在 `Decoder`

## 全局热键：为什么是 JNA 而不是 jnativehook

原版在 Windows 上**不用低级键盘钩子**，而是每 8ms 轮询 `GetAsyncKeyState(0xA1)`
（见 `electron/services/globalKeyService.js` 的注释）：游戏普遍注册 Raw Input，
会让其它进程的 `WH_KEYBOARD_LL` 钩子收不到按键，表现为「游戏内不亮」。轮询游戏里照样有效。

Java 侧按同一套方案实现（`system/RightShiftPoller.java`），只把 FFI 换成 JNA：

- 原先考虑的 `com.github.kohlschutterboy:jnativehook` 在本机可达的仓库里都没有
  （阿里云 public/central 无此构件，JitPack 需授权，Maven Central 不可达）；
- `net.java.dev.jna:jna` 阿里云镜像上有，只声明了 `user32.dll` 里的一个函数，
  不引 `jna-platform`。因为项目按模块运行，jar 要走 module path，
  `module-info.java` 里对应 `requires com.sun.jna;`（JNA 的 automatic-module 名字）。
- 取不到原生热键（非 Windows / JNA 加载失败）时不崩，退回窗口内 `Shift+R`。
  两者不能同时存在——一次按键触发两次会先收起又立刻展开，等于没反应。

## 像素级对齐：字形图集

原版**不是**用浏览器排版画文字的。`utils/sigmaFontAtlas.js` 用 Java2D 把每个字形烘成位图
（同源于 sigmarebase 的 Slick `TrueTypeFont`），前端只按 `advance` 逐字贴图、
`imageSmoothingEnabled = false`，注释里写明「保证英文与原版逐像素一致」。
换成 JavaFX 的 `Label`/`Text` 是另一套光栅化 + 字距调整，英文数字都会差几个百分点。

所以 Java 侧直接把仓库里现成的 8 张图集搬过来用：

| 类 | 职责 |
|---|---|
| `ui/SigmaAtlas` | 载入 `atlas-<family>-<size>.json/png`，提供 `lineHeight` / `ascent` / 字形 advance；`measure()` 逐字累加 advance（**不能**用 `Text.getLayoutBounds()`，那是整串排版） |
| `ui/SigmaTextView` | canvas 渲染的文字节点，1:1 复刻 `SigmaText.vue`：居中/右对齐取 `floor((cssW - textWidth)/2)`、上沿取 `floor((cssH - lineHeight)/2)`、跑马灯、`truncate`、按色缓存的染色 |

已接入的位置与原版完全一致：

| 元素 | 图集 | 盒高 |
|---|---|---|
| Logo `Jello` | light-40 | 44 |
| Logo `music` | light-20 | 22 |
| 歌名 / 歌手 / 时长 | light-14 | 16 |
| 歌单项 | light-13 | 17（= `lineHeight`，项高 7+17+7=31，步进 33） |
| 缩略卡歌名 / 歌手 | sans-12 | 13 |
| 搜索框 | sans-25 | 70（基线走 `SigmaTextField` 的浏览器度量算法，不是 lineHeight） |

图集只含 ASCII（224 字形），中文等缺字形退回字体渲染，宽度按
`ceil(单字度量)` 取 —— 与原版的 `FALLBACK_STACK` 分支一致。

## JavaFX 21 做不到的 CSS（以及绕法）

| 原版 CSS | JavaFX 21.0.5 | 本项目的绕法 |
|---|---|---|
| `text-overflow: ellipsis` | `Labeled.setTextTruncation` 是 JavaFX 22+ 才有的，21 上没有；`Label` 只会硬裁掉溢出部分，尾部一个字都不剩 | `ui/SigmaText.truncate` 1:1 复刻原版 `truncateSigmaText`：超宽就逐字截到放得下为止再补一个 `…` |
| `overflow-y: auto` + 隐藏滚动条 | `ScrollPane` 的 `.viewport` 有白色模期背景，只写 `transparent` 管不到它 | `ui/SigmaScrollablePanel`：Pane + 内层 Pane 平移 + clip，滚轮位移直接取 `deltaY` |
| `transform: scale()` 绕中心 | `Node` 没有公开的 `setPivotX`（`javap` 实测） | 按缩放比例把 `layoutX/Y` 往回挪半个差值，等价于绕中心缩放 |

## 包结构

```
com.jello.music
├── api/KuGouApiClient.java     调本地 KuGouMusicApi
├── api/Playlist.java           歌单元数据（gid/sort/owner）
├── api/PlaylistTab.java        左栏条目：猜你喜欢 / 每日推荐 / 歌单
├── model/KuGouCredentials.java 登录态与 Authorization 拼装
├── model/Song.java             歌曲
├── model/ResultCard.java       右栏卡片：歌曲卡 / 歌单卡
├── player/Fft.java             radix-2 FFT（不加窗，对齐 sigmarebase JavaFFT）
├── player/SpectrumTap.java     旁路拉流解码取 PCM（/32768 归一化）
├── player/SpectrumFeed.java    visualizerData 队列（上限 18）+ 后台供给
├── player/PlayQueue.java       播放队列与循环模式
├── system/RightShiftPoller.java 全局右 Shift（Win32 GetAsyncKeyState 轮询）
├── system/MousePassthrough.java 频谱窗鼠标穿透（Win32 WS_EX_TRANSPARENT）
├── ui/SigmaAtlas.java          字形图集载入与度量
├── ui/SigmaTextView.java       canvas 文字节点（SigmaText.vue 1:1）
├── ui/SigmaScrollablePanel.java 滚动容器（SigmaScrollablePanel.vue 1:1）
├── ui/SpectrumView.java       频谱条绘制（renderSpectrum 1:1）
├── ui/SpectrumInfoBlock.java  频谱窗左下角信息块（封面 + 歌名 + 低频缩放）
├── ui/                         JavaFX 界面，坐标全部取自 Theme
├── tools/PipelineProbe.java    端到端链路探针（无窗口）
├── tools/UiProbe.java          静默 UI 校验（不弹窗，65 项断言）
└── tools/PlaybackProbe.java    静音播放链路实测（不发声）
```

## 三种校验

```bat
run.bat probe        :: 端到端链路：api -> 直链 -> 解码 -> FFT
run.bat probe-ui     :: 静默 UI：离屏渲染 + 48 项断言，不弹窗不抢焦点
run.bat probe-play   :: 静音播放：真实解码/定位/切歌，音量钉 0
```