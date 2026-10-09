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

运行（凭据走环境变量，避免 token 进命令行历史）：

```powershell
set JELLO_TOKEN=<token>
set JELLO_USERID=<userid>
set JELLO_DFID=<dfid>
set JELLO_HASH=<歌曲hash>
mvn -s settings.xml exec:java
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

## 暂缓的依赖

`com.github.kohlschutterboy:jnativehook`（全局热键，替代 `uiohook-napi`）在本机可达的仓库里都取不到：阿里云 `public`/`central` 无此构件，JitPack 需授权，Maven Central 不可达。已在 `pom.xml` 中注释掉，接入全局热键时需补回。它含 `.dll`/`.dylib`/`.so`，`jpackage` 打包要一并处理。

## 包结构

```
com.jello.music
├── api/KuGouApiClient.java     调本地 KuGouMusicApi
├── model/KuGouCredentials.java  登录态与 Authorization 拼装
├── player/Fft.java             radix-2 FFT + Hann 窗
├── player/SpectrumTap.java     旁路拉流解码取 PCM
└── tools/PipelineProbe.java    端到端探针
```

`ui/`（JavaFX 界面）、`system/`（托盘/热键/全屏检测）、`MainApp.java` 尚未开始。