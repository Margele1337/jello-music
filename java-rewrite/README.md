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
run.bat probe          :: 只跑无窗口的链路探针
run.bat <直链URL>      :: 指定音频直链
```

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
| 搜索结果区 | 滚轮上下翻，滚动条按原版隐藏 |
| 频谱 | 后台线程拉流解码 + FFT，实时绘制 |

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
├── api/Playlist.java           歌单元数据
├── model/KuGouCredentials.java 登录态与 Authorization 拼装
├── model/Song.java             歌曲
├── player/Fft.java             radix-2 FFT + Hann 窗
├── player/SpectrumTap.java     旁路拉流解码取 PCM
├── player/SpectrumFeed.java    频谱数据的后台供给
├── player/PlayQueue.java       播放队列与循环模式
├── system/RightShiftPoller.java 全局右 Shift（Win32 GetAsyncKeyState 轮询）
├── ui/                         JavaFX 界面，坐标全部取自 Theme
├── tools/PipelineProbe.java    端到端链路探针（无窗口）
├── tools/UiProbe.java          静默 UI 校验（不弹窗，48 项断言）
└── tools/PlaybackProbe.java    静音播放链路实测（不发声）
```

## 三种校验

```bat
run.bat probe        :: 端到端链路：api -> 直链 -> 解码 -> FFT
run.bat probe-ui     :: 静默 UI：离屏渲染 + 48 项断言，不弹窗不抢焦点
run.bat probe-play   :: 静音播放：真实解码/定位/切歌，音量钉 0
```