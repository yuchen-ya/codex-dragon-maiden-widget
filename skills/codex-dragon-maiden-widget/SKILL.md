---
name: codex-dragon-maiden-widget
description: 显示 Codex 小龙娘，读取订阅额度、检查提问和授权提醒及自动跟随状态。仅在用户需要操作小龙娘时使用。
---

# Codex 小龙娘 v0.1.4

优先使用本插件的 `dragon_quota`、`dragon_usage`、`dragon_status`、`dragon_open` 工具。未连接时，从插件根目录运行 `node scripts/control.mjs status`；查询额度使用 `node scripts/control.mjs quota`。报告实际结果，不把未运行的检查称为通过。

订阅额度来自官方 `account/rateLimits/read`；本机 token 统计不代表官方剩余 token。读取失败时说明原因，不展示缓存为实时结果，不修改 Codex 的模型、登录或 API 配置。

默认随 Codex 显示、隐藏。尊重用户主动隐藏或退出的选择。第一版与 A 版形象在菜单中切换；音效默认静音，可在“声音与气泡”开启。

提问、授权提醒沿用等待气泡，同一请求只提示一次。Hook 只记录本机请求标识、类型与时间，不自动授权，不记录问题、答案或工具参数。首次安装或命令改变后，由用户在 Codex Hooks 界面审核并信任 `interaction-hook.mjs`；不得代替用户设置信任。

完整 Windows 安装：双击 `安装插件.cmd`；只检查可运行 `scripts/install-package.ps1 -CheckOnly`。卸载使用 `卸载小龙娘.cmd`，保留个人设置与素材。回滚使用 `回滚本次安装.cmd` 及本次安装生成的私有回执，不猜测回执路径，不操作其他插件或任务。

隐私：不公开登录凭据、IPC token、配置文件、原始会话、个人路径或安装回执。故障排查只报告必要的状态与错误类别。

macOS 使用 `安装 Mac 自动跟随.command` 安装，支持窗口跟随、独立桌面、停用与回滚；已在 Apple Silicon 实机验收。保留贡献者 [1llysviel 的 PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128) 署名。
