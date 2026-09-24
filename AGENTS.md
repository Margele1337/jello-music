# AGENTS.md

## 工作流约定（用户要求）

- 完成修改并通过构建后，**自动提交并推送到 GitHub**（`origin main`），不需要每次征求确认。
- 提交信息用中文，遵循约定式提交（`feat` / `fix` / `chore` / …），正文用 `-` 列表说明改动与验证方式。
- **发版（打 tag、触发 Release CI）需要用户明确要求**：发版提交信息必须包含 `chore: release`，并同步提升 `package.json` / `package-lock.json` 的版本号。
  - CI 版本逻辑：`package.json` 版本 ≠ 最新 tag 时用 `package.json` 版本，相等则 patch+1。
- 不要提交 `api` 子模块（postinstall 补丁会使其 dirty）。
- 提交前用 `git diff --stat` 确认真实改动：工作区存在大量 mtime 噪音的“伪 modified”文件，只 `git add` 目标文件。

## 构建与验证

- 前端构建：`npm.cmd run build`（PowerShell 禁止 `npm.ps1`，必须用 `npm.cmd`）。
- 本地打包验证：`npm.cmd run electron:build -- --win --x64 --dir`。
  - 普通 Windows 账户解压 winCodeSign 的 macOS 符号链接会报错，已手动解压到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`（排除 `darwin`），打包即可正常写入 exe 图标/元数据。
- 仓库没有 lint / typecheck 脚本。

## 环境注意

- `git push`、构建工具的进度输出走 stderr，PowerShell 会显示为红色“错误”但实际成功，以退出码为准。
- 推送 `github.com` 偶尔会被连接重置（需要用户开启代理/VPN），失败时重试或等网络恢复。
- 临时脚本用 ASCII 内容写（PowerShell 5.1 会按 ANSI 读取无 BOM 的 UTF-8 脚本，中文注释会导致解析错误）。
