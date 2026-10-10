# 交接说明（给云端 AI）

> 本文件是给**云端那台机器上的 AI** 看的。读完直接按「现在能做什么 / 不能做什么」执行。
> 如果你看到的仓库状态和下面「当前状态」对不上，以 `git log -1` 为准并优先相信文件。

---

## 0. 一句话背景

这是一个 **GPL-2.0-only** 的音乐播放器，Windows-only。
原版是 Electron + Vue，现在正在 **`java-rewrite` 分支上用 JavaFX 1:1 复刻**。
用户要求 **严格 1:1**，所有坐标/配色/尺寸都必须从 Vue 原版逐项照抄，不接受"差不多"。
仓库根目录的 `AGENTS.md` 是用户的工作流约定，**优先级高于本文件**，请先读它。

---

## 1. 当前状态

| 项目 | 值 |
|---|---|
| 分支 | `java-rewrite`（**不是 main**） |
| 最新提交 | `9e443a0` feat: 新增搜索框与结果卡片网格（SigmaSearchBox 1:1） |
| main 最新 | `59c72c7`（Vue 版，v2.3.0 已发布，本轮不动它） |
| 编译 | `mvn clean compile` 通过 |

### 已经做完的（别重做）

- JavaFX 透明窗 + `MediaPlayer` 播放酷狗 MP3 直链（实测出声）
- 后台 JLayer 解码 + FFT 实时频谱（`MediaPlayer` 不吐 PCM，必须自己解一路）
- 贴边收起/滑出 + 弹性缩放动画（复刻 Minecraft 原版 `ClickGuiScreen` 的插值公式）
- 真实歌曲元数据：`/user/playlist` → `/playlist/track/all` → `/song/url` 全链路
- `SigmaMusicPlayer.vue` 模板里 **18 个元素全部实现**，坐标与原版常量一一对应
- 底部封面条真实 `GaussianBlur(15)`（对齐原版 `filter: blur(15px)`）
- 进度条点击/拖动 seek、播完自动下一首、三态循环按钮
- 搜索框 + 结果卡片网格 + `/search/complex`

> ⚠️ **纠正一个可能的误判**：如果你对照 Vue 原版觉得「搜索/结果区没做完」，
> 那是你看的快照太旧。`SearchBox.java`、`ThumbnailCard.java`、`KuGouApiClient.search()`
> 已经在 `9e443a0` 里了。动手前先 `ls java-rewrite/src/main/java/com/jello/music/ui/` 确认。

### 还没做的（真正的 TODO，按建议优先级）

1. **结果网格滚动** — `SearchBox.showResults()` 现在只铺前两行就 `break`，超出的结果点不到。
   原版用 `SigmaScrollablePanel`，需要实现滚动。
2. **跑马灯** — 原版 `SigmaText` 带 `scroll` 属性，超长文字会横向滚动。
   JavaFX 侧 `PlayerPanel` / `ThumbnailCard` 的 Label 只是 clip 截断，没有滚动动画。
3. **全局 RSHIFT 热键** — 折叠用 `jnativehook`，**拉不到依赖**（阿里云无构件、
   JitPack 需授权、Maven Central 不可达）。`pom.xml` 里已注释。
   备选：Win32 `RegisterHotKey` / JNA / 纯 JavaFX 无法做全局键。
4. **真实播放行为验证** — seek、自动切歌、循环三态都写了但**没在真实音频上验过**
   （写的时候没出声，见第 2 节）。需要 API + 凭据。
5. **歌单省略号** — 原版 `text-overflow: ellipsis`，JavaFX 21 做不到（见第 4 节 #8）。
6. **jpackage 打包** — 还没做。

---

## 2. 你这台机器缺什么（重要）

云端环境已知：

- ✅ Maven 可用（`mvn clean compile` 能过）
- ❌ **没有 git**（找不到 `git.exe`）→ **无法 commit / push**
- ❌ **本地 KuGou API 没跑**（`127.0.0.1:6521` 连不上）→ **无法做真实播放验证**
- ❌ **没有登录凭据** → 即使 API 起来了也拿不到歌单/直链

### 所以云端该干什么

**主力做 UI + 静默验证。** 这两件事不需要 git、不需要 API、不需要凭据。

```cmd
cd java-rewrite
run.bat probe-ui
```

这是**静默 UI 校验**：只 `Platform.startup()` 启动 JavaFX 工具箱，**全程不创建 Stage**，
所以不会弹窗、不会抢焦点、不会发声。手工 `applyCss()+layout()` 后对节点树做离屏 `snapshot`，
断言布局并输出 PNG 到 `%TEMP%\jello-ui-probe.png`。

退出码 0 = 全过，非 0 = 有回归。**改完 UI 必须跑这个再交付。**
现在有 24 项断言，覆盖：歌名/歌手/时间 Label 的存在性与坐标、宽高非零、
专辑封面 114x114 且无 Canvas 遮挡、封面条模糊（自对照 blurred 6.57 / sharp 22.87）、
循环按钮三态、单行标题 y=562、41px 触发条、文字 nowrap+clip、搜索框位置、卡片网格坐标。

### 双机协作流程（务必按这个来）

```
   云端 AI 改文件  ──►  用户把整个文件夹拷回主电脑  ──►  我（主端）编译/提交/推送
   （无 git，裸改）        （你来操作，不是 AI 操作）
```

主端有 git 和已推送的完整历史，云端**没有 git**。所以：

**你只管改文件，不要尝试装 git、不要尝试 commit。** 提交是主端的事。

### 你的安全网：改之前先备份（因为没有 git，不能撤销）

云端**没有版本控制**，改错了没法回退，只能让用户重新拷一遍。所以每改一个文件前：

```powershell
$bk="D:\Code\Jello-music\.cloud-backup"; New-Item -ItemType Directory -Force $bk | Out-Null
Copy-Item "<要改的文件>" "$bk\<文件名>.bak" -Force
```

目录已经加进 `.gitignore`，不会被提交。**改坏了让用户从这里恢复。**

### 必须维护 `CLOUD-NOTES.md`

因为云端没有 commit 历史，用户拷回来之后**主端看不出你改过什么**。
所以你每完成一项，就在仓库根目录维护 `CLOUD-NOTES.md`（已存在就追加，没有就新建）：

```markdown
## <日期> <做了什么>
- 改动文件：相对路径列表
- 改动原因：一句话说清
- 验证：run.bat probe-ui 是否全过（贴最后一行结论）
- 遗留 / 需要主端接手确认的点
```

主端接手时**第一件事就是读这个文件**，靠它跳过你已完成的工作。

### 怎么把改动送回主机器

你改完告诉用户"请把整个 jellomusic 文件夹拷回主电脑"，并附上 `CLOUD-NOTES.md` 的内容摘要。

⚠️ **提醒用户拷贝时的两个坑**（你可以主动提醒）：

1. **`api/` 子模块文件夹可能被覆盖。** 云端没有 API 服务，`api/` 里可能是空的或不完整。
   拷回主机会把主端能正常工作的 `api/` 冲掉 → **让用户跳过 `api/` 目录**。
2. **`.git/` 建议跳过。** 主端会在 `java-rewrite` 分支上直接接着改，
   用主端自己的 `.git` 即可，避免旧历史覆盖。

`target/`、`cp.txt`、`.cloud-backup/` 属于构建产物/本地文件，拷不拷都无所谓。

---

## 3. 改动前必读：JavaFX 21.0.5 的实际行为

这一节是**踩坑记录**，全部用 `javap` 在本机 JavaFX 21.0.5 上验证过。
**照抄原版 CSS/CSS 语义时几乎一定会踩，照着这份清单避坑。**

1. **`rgba(1, 1, 1, x)` 是近黑色，不是白色。**
   CSS 的 `rgb()` 分量是 0..255 量级，所以 `rgb(1,1,1)` ≈ 纯黑。
   而 JavaFX 的 `Color.color(1, 1, 1, x)` 里 `1.0` 就是**纯白**。
   写错的后果：底部条遮罩变成 43% 白 → `#fefefe` 的歌名/时长**全部隐形**。
   同一个错在音量轨道、进度条填充上各犯过一次。
   → 一律走 `Theme.rgb(r,g,b,a)` 辅助方法，不要直接 `Color.color()`。

2. **Pane 里的 Label 不给高度会完全不渲染。**
   只设 `prefWidth` 不设 `prefHeight`，尺寸算出来是 0×0，节点什么都不画。
   → `PlayerPanel.styleText()` 里已给 `prefHeight/minHeight = size + 6`，照抄这个模式。

3. **`new Image(url, true)` 是后台加载（异步）。**
   构造函数返回时宽高还是 0，算出的缩放比是 `NaN`，`drawImage` 什么都不画，
   而且**没有"加载完再重绘"就永远画不出来**。
   → 监听 `img.progressProperty()`，到 1.0 再 `Platform.runLater(...)` 重绘。
   （`Image` 没有 `isLoading()`，用 `img.getProgress() < 1.0` 判断；
   也没有 `getError()`，用 `getException()`。）

4. **`BackgroundFill` 的参数顺序是 `(Paint, CornerRadii, Insets)`——Insets 排最后。**
   写成 `(Paint, Insets, CornerRadii)` 会连续编译失败三轮。

5. **`Background` 的静态工厂只有 `fill(Paint)`。**
   要叠多层（比如 inset 描边）只能 `new Background(fill1, fill2, ...)`，
   后画的在上，所以「底色在前、描边在后」。

6. **`TextField` 不是 `Labeled`，没有 `setTextFill`。**
   文字颜色只能走 CSS：`.setStyle("-fx-background-color: transparent; -fx-text-fill: #fefefe;")`。

7. **这个 JavaFX 构建的 `Node` 没有公开的 `setPivotX`，也没有 `hovered` 属性。**
   （`javap javafx.scene.Node` 实测。）所以：
   - CSS `transform: scale()` 的「绕中心缩放」用不上 pivot，
     `ThumbnailCard.scaleCover()` 改成「按缩放比例把 `layoutX/Y` 往回挪半个差值」等价实现。
   - 只能监听 `focusedProperty()`，做不了 hover 态。

8. **`TextTruncation` / `Labeled.setTextTruncation` 是 JavaFX 22+ 才有的，21.0.5 没有。**
   所以 `text-overflow: ellipsis` 做不了，只能 clip 截断。

9. **`Node` 没有 `getWidth()/getHeight()`**（那是 `Region` 的）。
   → 用 `node.getBoundsInParent()`。

10. **`lookupAll(λ)` 会编译失败。**
    `Parent.lookupAll(String)` 和 `Node.lookupAll(Predicate)` 同名，javac 把 lambda 判给 String 那个，
    报 "String is not a functional interface"。→ 自己递归遍历 `Parent.getChildrenUnmodifiable()`。

11. **`MediaPlayer.seek()` 收 `javafx.util.Duration`，不是 `java.time.Duration`。**

12. **JavaFX 必须走 module path。**
    classpath 启动会报 `Unsupported JavaFX configuration: classes were loaded from 'unnamed module'`。
    `run.bat` 里是 `java --module-path "%CP%" -m com.jello.music/com.jello.music.MainApp`。

13. **`ValueAnimator` 在这个版本的 graphics jar 里缺失。**
    动画都用 `AnimationTimer` 手动按时间推进。

14. **复用的属性不能重复 `bindBidirectional`，会抛 `IllegalArgumentException`。**
    症状是"第一首能播，第二首起就报初始化失败"。换歌前先 `unbindBidirectional` 旧的。
    （`PlayerPanel.bindPlayer` 已修，照抄那个模式。）

15. **原版有些坐标是写死的表，不是等差数列。**
    例：结果网格列位置是 `[10, 183, 356][index % 3]`。
    按 `10 + col * 183` 推会算成 10/193/376，**整排错位 10px**。
    → 遇到 `[...][index % n]` 这种写法，一律照抄数组，不要推导。

---

## 4. 工具链坑（会浪费你很多时间）

1. **写完 `.java` 一定要剥 UTF-8 BOM。**
   某些写文件工具在 Windows 上会带 BOM，javac 直接报
   `illegal character: '\ufeff'`。剥法：
   ```powershell
   $p="<文件路径>"; $t=[System.IO.File]::ReadAllText($p)
   [System.IO.File]::WriteAllText($p,$t.TrimStart([char]0xFEFF),(New-Object System.Text.UTF8Encoding($false)))
   ```

2. **不要用 PowerShell 的 `Set-Content` 改含中文的源码。**
   `-Encoding UTF8` 会写 BOM **并且把中文搞成乱码**。用编辑工具改，或用上面的 .NET 写法。

3. **PowerShell 没有 heredoc**，`git commit -F - <<EOF` 会报语法错。
   把提交信息写进临时文件（UTF-8 无 BOM），再 `git commit -F <路径>`。

4. **`cd` 不会改 `[Environment]::CurrentDirectory`。**
   `[System.IO.File]::ReadAllBytes("相对路径")` 仍按进程启动目录解析，
   看起来像"文件不存在"。→ .NET API 一律用绝对路径。

5. **PowerShell 会把 `-Dxxx=yyy` 这类参数拆坏**，用 `"-Dfile.encoding=UTF-8"` 加引号。

6. **本机 git 不支持 `--encoding`。** `git commit --encoding=UTF-8` 会报 unknown option。
   提交信息文件写成 UTF-8 无 BOM 即可。

7. **PowerShell 里 javac/maven 的中文报错是乱码，读不出错在哪。**
   拿英文报错：
   ```powershell
   javac "-J-Duser.language=en" "-J-Duser.country=US" -encoding UTF-8 --module-path $cp -d $out $src
   ```
   （`-J-Duser.language=en` **必须加引号**，否则 PowerShell 拆成 `-J-Duser` + `.language=en` 直接报"无效标志"。）

8. **提交时只 `git add` 目标文件。**
   `api` 子模块的 postinstall 补丁会让它永远显示 dirty，**不要提交它**。
   工作区还有大量 mtime 噪音的"伪 modified"文件。

---

## 5. 怎么加一条 UI 断言（做新功能时顺手加）

打开 `java-rewrite/src/main/java/com/jello/music/tools/UiProbe.java`，
在 `run(...)` 里加断言，然后 `run.bat probe-ui` 验证。

可用的现成工具函数：

- `collect(root, SomeNode.class)` — 按类型递归收集节点（**不要用 `lookupAll(λ)`**，见第 3 节 #10）
- `firstWithText(labels, "文本")` — 按文本找 Label
- `check(name, ok, detail)` — 打印 PASS/FAIL 并累计失败数
- `at(node)` — 格式化 `x/y/w/h`
- `rmsGradient(snapshot, x, y, w, h)` — 区域水平梯度 RMS，用来量化「模糊」
- `loadCheckerboard(w,h,cell)` / `drawCover(...)` — 做模糊自对照用

**断言要写死原版常量，不要写"差不多"的值。**
例：`check("循环模式按钮存在 @ (264,540)", repeat != null && repeat.getLayoutX() == Theme.REPEAT_X && ...)`

---

## 6. 做完怎么交付

1. `run.bat probe-ui` 全过（退出码 0）
2. `mvn clean compile` 无 ERROR
3. **更新 `CLOUD-NOTES.md`**（见第 2 节，这是主端唯一的线索）
4. 告诉用户"可以拷回主电脑了"，并提醒**跳过 `api/` 和 `.git/`**
5. 保持 1:1，不要自作主张"优化"视觉

如果实在需要真机验证播放行为，明确告诉用户"这一步需要 API + 凭据 + 出声"，
让用户决定要不要现在做。

---

## 7. 绝对不要做的事

- ❌ **不要装 git、不要 commit、不要 push。** 那是主端的活。
- ❌ **不要动 `api/` 子模块。** 它是独立仓库，且主端那份是能用的。
- ❌ **不要改 `main` 分支涉及的文件。** 当前所有工作在 `java-rewrite`。
- ❌ **不要引入新的 Maven 依赖。** Maven Central 不可达、阿里云镜像只有常用包，
  拉不到的东西只会卡住编译（`jnativehook` 就是这么卡住的）。
- ❌ **不要把任何凭据写进源码或配置文件。** 登录 token / userid / dfid 一律走环境变量。
- ❌ **不要"顺手优化"布局坐标。** 1:1 是硬要求，原版是多少就是多少。
  觉得难看也照抄 —— 用户的原版审美就是这样。
- ❌ **不要把调试日志留在代码里。** `System.out.println` 走完就删。
- ❌ **不要为了让 probe 变绿去改断言。** probe 红了说明代码有问题，
  改代码；确实要改断言时在 `CLOUD-NOTES.md` 里写明理由。
- ❌ **不要在云端跑 GUI 验证。** 用户在打游戏，弹窗会抢焦点。
  只跑 `probe-ui`（不弹窗）或 `probe`（无头）。
