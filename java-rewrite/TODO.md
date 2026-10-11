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
- [ ] **设置页**（`src/views/Settings.vue`，1630 行，4 分类 30+ 项）
      - [ ] 先砍清单：Electron 专属项（托盘菜单、代理、自定义 API 地址、日志导出、
            自动更新、API 模式）在 Java 版没有对应物，需与用户确认取舍
      - [ ] 界面分类里对 Java 版有意义的：重置界面、频谱开关、频谱幅度/平滑/音画延迟、
            频谱锁定、教程入口
      - [ ] 声音分类：音质选择（128/320/…）、响度标准化、数据源
      - [ ] 视图骨架：220px 侧栏 + 内容区 + 每分类「重置」+ 版本页脚 + 返回箭头

## B. 播放器内的缺口

- [ ] **第 4 种循环状态（随机播放）** —— `RepeatButton` 硬夹在 `0..2`，
      原版 4 态、第 4 态是内联 SVG 随机图标；`PlayQueue.Repeat` 也要加 SHUFFLE
- [ ] **贴边收起的半透明态 + 越界橡皮筋** —— 原版拖拽越过右缘时面板**先半透明**、
      松手才吸附；`EdgeDock` 目前没有任何 opacity / overhang 逻辑
- [ ] **dock 滑动曲线不一致** —— 原版是每帧 `0.25 × dt/18.10361` 插值 + 120ms 节流 +
      3s 卡死看门狗；现在是固定 450/125ms cubic ease-out
- [ ] **频谱参数** —— `spectrumScale`（0.2~3）、`spectrumSigmaSmoothing`（默认 0.335）、
      `spectrumAvDelay`（默认 590ms）三个设置没有；HUD 尺寸 220×60、48 频段、FFT 2048 写死
- [ ] **频谱窗状态不持久化** —— 原版存 `spectrumWindowPosition/Size`，
      且只按主屏摆一次，不跟随多显示器变化、不做游戏全屏时的贴底
- [ ] **拖拽排除列表** —— 原版排除 `button, input, .sigma-search-box, …` 才允许起拖，
      现在直接挂在整个根 Pane 上

## C. 系统级（Electron 专属，Java 版无对应，暂不排期）

- [ ] 托盘图标 + 托盘菜单（9 项操作 + 自定义 HTML 菜单窗）
- [ ] 其余 11 个全局快捷键（目前只有 RSHIFT）
- [ ] 任务栏缩略图工具条（上一首/播放暂停/下一首）、Jump List
- [ ] 桌面歌词窗、KeyStrokes HUD（WASD + 鼠标键覆盖层）
- [ ] 自动更新、单实例锁、`jello://` 协议、内置 api 子进程、WebSocket API 服务（6520）
- [ ] 设置持久化：原版 5 个键（settings / windowState / 歌词窗位置大小 / 频谱窗位置大小），
      现在 `AppPrefs` 只有教程标记一个

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