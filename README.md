<br />
<p align="center">
  <h2 align="center">Jello Music</h2>
  <p align="center">基于 MoeKoe Music 的魔改版 · 酷狗音乐第三方客户端</p>
</p>

> [!IMPORTANT]
> 本仓库是第三方魔改版（Fork），并非官方版本，与原作者及酷狗音乐官方均无任何关联。
> 上游项目：[iAJue/MoeKoeMusic](https://github.com/iAJue/MoeKoeMusic)（GPL-2.0-only，作者 MoeJue）。

## 相比上游的主要改动

- 品牌更名为 Jello Music：应用名、包名（`cn.jello.music`）、深链协议（`jello://`）、托盘/快捷方式/跳转列表全部统一
- 新增 Sigma UI：还原 sigmarebase 客户端内音乐播放器的独立透明窗口（`800x600`），主窗口隐藏继续播放
  - 点歌/换歌跟随当前列表：整表替换播放队列
  - 猜你喜欢、每日推荐、歌单、搜索内嵌在窗口内，设置与登录页也可在窗口内完成
  - 贴右边缘收起/滑出、透明度渐变与拖拽均按原版逻辑复刻
  - 全局 rAF 动画驱动 + 主进程看门狗接管，窗口离屏也不掉帧
- 以 sigma_rebase client 方案重写桌面频谱：原版 FFT 采集、帧率补偿平滑，修复幅度偏小与卡顿
- 新增「频谱幅度」设置（0.2x~3.0x 实时调节）
- 频谱窗口自动贴底：无全屏时贴任务栏上沿，其它应用全屏时贴屏幕最下方
- 托盘右键与 Windows 跳转列表（任务栏图标右键 → 任务）可直达设置

## 功能

- 酷狗账号登录（扫码 / 手机 / 账号）
- 每日推荐、歌单收藏、排行榜、搜索、云盘、本地音乐、MV 播放
- 歌词与桌面歌词、主题与布局个性化、插件系统、多语言

## 安装

安装包见 [Releases](https://github.com/Margele1337/jello-music/releases)。

## 开发

```sh
git clone --recurse-submodules https://github.com/Margele1337/jello-music.git
cd jello-music
npm run install-all
npm run dev                    # 开发模式
npm run build                  # 构建前端
npm run electron:build:win     # 打包 Windows（macos / linux 同理）
```

## 免责声明

- 本项目为第三方客户端，仅供学习研究，禁止商业及非法用途。
- 使用过程中可能产生版权数据，版权归原权利人所有，请在 24 小时内清除。
- 音乐平台不易，请尊重版权，支持正版。
- 如官方认为本项目不妥，可联系更改或移除。

## 开源协议

采用 [GNU General Public License v2.0](LICENSE)（GPL-2.0-only）。源代码原项目版权归 MoeJue 所有，本仓库修改部分归 Margele1337 所有。

## 相关链接

- [iAJue/MoeKoeMusic](https://github.com/iAJue/MoeKoeMusic) — 原项目
- [Margele1337/jello-music](https://github.com/Margele1337/jello-music) — 本仓库
