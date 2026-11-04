---
name: codex-dragon-maiden-widget
description: 显示 Codex 小龙娘，读取订阅额度、检查提问和授权提醒及自动跟随状态。仅在用户需要操作小龙娘时使用。
---

# Codex 小龙娘 v0.1.11

优先使用本插件的 `dragon_quota`、`dragon_usage`、`dragon_status`、`dragon_open` 工具。未连接时，从插件根目录运行 `node scripts/control.mjs status`；查询额度使用 `node scripts/control.mjs quota`。报告实际结果，不把未运行的检查称为通过。

订阅额度来自官方 `account/rateLimits/read`；本机 token 统计不代表官方剩余 token。读取失败时说明原因，不展示缓存为实时结果，不修改 Codex 的模型、登录或 API 配置。

默认随 Codex 显示、隐藏。尊重用户主动隐藏或退出的选择。第一版与 A 版形象在菜单中切换；音效默认静音，可在“声音与气泡”开启。

点击露出的尾尖收起身体；侧边中央位置会向最近的窗口边缘收起，展开回到原位置。尾巴使用完整素材绕固定根部轻拉，避免切口悬空。收起后完全免打扰，所有气泡、提醒点、错误提示与音效均停用；单击轻摆，拖拽或在 1.2 秒内连续点击 4 次恢复，展开动画结束后才接一句专属短句。收起状态会保存，恢复位置命令同时展开角色。

发送后情境反应默认关闭，可在 Jev 服务与网络页启用；开关旁提示云端计费、敏感内容过滤局限与注意力风险。只分析合格短文字，截图不上传；调用前过滤长数字与疑似凭据。工作安排、问题反馈、返工、方案认可和情绪均可简短回应。内部日志仅记录分类、耗时和展示结果，不记录正文或密钥，不显示在用户界面。

设置中可自定义称呼，默认老大，留空恢复默认。内置台词集中在 assets/dialogue-library.json；个人数据目录的 dialogue-custom.json 是实际编辑库，更新不覆盖，修改后重启生效。使用 {title} 占位符；无效条目跳过、长句截短，缺少提问/授权文案仍保留系统提醒。

提问、授权提醒沿用等待气泡，同一请求只提示一次。Hook 只记录本机请求标识、类型与时间，不自动授权，不记录问题、答案或工具参数。首次安装或命令改变后，由用户在 Codex Hooks 界面审核并信任 `interaction-hook.mjs`；不得代替用户设置信任。

完整 Windows 安装：双击 `安装插件.cmd`；只检查可运行 `scripts/install-package.ps1 -CheckOnly`。卸载使用 `卸载小龙娘.cmd`，保留个人设置与素材。回滚使用 `回滚本次安装.cmd` 及本次安装生成的私有回执，不猜测回执路径，不操作其他插件或任务。

隐私：不公开登录凭据、IPC token、配置文件、原始会话、个人路径或安装回执。故障排查只报告必要的状态与错误类别。

macOS 使用 `安装 Mac 自动跟随.command` 安装，支持窗口跟随、独立桌面、停用与回滚；已在 Apple Silicon 实机验收。保留贡献者 [1llysviel 的 PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128) 署名。
