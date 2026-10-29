# Codex 小龙娘

支持 **Windows 和 macOS** 的 Codex 小龙娘桌宠：查看订阅额度、切换个性文案，在需要回答或授权时提醒你。随 Codex 窗口自动显示隐藏。

[下载最新版本](https://github.com/yuchen-ya/codex-dragon-maiden-widget/releases/latest) · [Windows 安装](#windows-安装) · [macOS 安装](#macos-安装)

![第一版](assets/dragon-maiden-bust-v1.png)

## 功能

- 点击角色查看 Codex 官方订阅额度，再点气泡切换文案、收起；不需要 API 密钥。
- 第一版、A 版两套形象，支持拖动、缩放、左右翻转、自定义素材和气泡。
- 提问显示“老大，我有个问题”，授权显示“这一步要你点头”；下方显示带中括号的会话短名称，同一请求不重复提醒。
- 每轮结束以角色气泡显示本机 token 用量，使用 K / M 缩写；不会覆盖正在等待的提问和授权提醒。
- 随机文案气泡可播放小龙娘摸头 GIF；连续点角色提高出现概率，再点气泡才切换内容。
- 默认静音，可在“声音与气泡”中分别开启音效。
- 登录 Windows 后启动后台监督器；打开 Codex 时显示，关闭或最小化时隐藏，恢复窗口后重新出现。桌宠大小不随 Codex 窗口缩小。

## Windows 安装

1. 安装并登录 Codex 桌面端。需要 Node.js 24+ 和 npm；安装器也会尝试复用 Codex 已有的 Node.js 24 运行时。
2. 从 [Releases](https://github.com/yuchen-ya/codex-dragon-maiden-widget/releases/latest) 下载安装包，完整解压到普通目录，双击 **`安装插件.cmd`**。不要在 ZIP 中直接运行。
3. 安装器复制代码、下载 Electron、注册本插件和登录自启快捷方式，自动启动小龙娘。无需自行 `npm install`，首次安装需要联网。
4. 在 Codex 的 **Hooks** 界面（CLI 输入 `/hooks`）审核并信任命令含 **`interaction-hook.mjs`** 的提醒 Hook。首次安装及命令改变时需要用户信任；安装器不会代替你授权。

安装器使用当前用户权限，不修改 Codex 程序、模型、登录方式或 API 配置。代码、数据和任务使用独立标识，与小鲸鱼原版分开：

| 内容 | 位置／名称 |
| --- | --- |
| 插件 | `codex-dragon-maiden-widget` |
| 安装代码 | `%USERPROFILE%/plugins/codex-dragon-maiden-widget` |
| 个人数据 | `%USERPROFILE%/.codex/dragon-maiden-widget` |
| 登录自启快捷方式 | `Codex Dragon Maiden Widget` |

安装失败请保留终端显示的私有回滚回执。只做预检可运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-package.ps1 -CheckOnly
```

## macOS 安装

已在 Apple Silicon、macOS 27.0.1、Retina 屏幕上进行实机验证；Intel Mac 尚未实测。

1. 安装并登录 Codex 桌面端，准备 Node.js 24+（含 npm）。启动器支持终端 PATH、Homebrew、nvm、Volta、mise，也会尝试复用本机可用的 Codex Node 运行时，并跳过低于 24 的版本。
2. 安装 Xcode Command Line Tools；如尚未安装，运行 `xcode-select --install`，安装完成后再继续。窗口探测组件使用本机 Swift 编译。
3. 从 [Releases](https://github.com/yuchen-ya/codex-dragon-maiden-widget/releases/latest) 下载 **`Codex-Dragon-Maiden-v0.1.4.zip`**，完整解压到固定目录，双击 **`安装 Mac 自动跟随.command`**。不要在 ZIP 中直接运行。安装器下载 Electron、编译窗口探测组件、配置订阅额度和提醒 Hook，并注册当前用户的 LaunchAgent。首次安装需要联网；下载会使用已配置的 HTTP(S) 代理。
4. 在 Codex 的 Hooks 界面审核并信任包含 `interaction-hook.mjs` 的提醒 Hook。

macOS 的个人数据和 Electron 位于 `~/.codex/dragon-maiden-widget`，登录启动项为 `~/Library/LaunchAgents/com.codex-dragon-maiden-widget.codex.plist`。代码直接使用当前项目目录；移动目录后应重新运行安装器。通过 `CODEX_HOME`、`WHALE_HOME` 自定义的数据目录会保存在启动项中。

- **`启动桌面挂件.command`**：恢复显示；`⌘⌥W` 可切换显示和隐藏。
- **`进入独立桌面.command`**：切换到不依赖 Codex 窗口的桌面模式。
- **`停止挂件服务.command`**：本次退出，下次重新打开 Codex 或手动启动时恢复。
- **`停用自动跟随.command`**：停止挂件并移除登录启动项，保留设置、素材和提醒 Hook。
- **`回滚 Mac 更新.command`**：使用本次安装的私有回执恢复先前的运行配置。

跟随模式下，挂件随 Codex 窗口移动和缩放；最小化、隐藏或切换到其他应用时隐藏，返回 Codex 后恢复。打开挂件设置时保持显示。额度读取支持 Mac 桌面端携带的 CLI，不依赖登录启动项的 shell PATH。自定义安装位置可在安装前设置 `WHALE_CODEX_APP_PATH`，手动指定 CLI 可使用 `CODEX_CLI`。

## 使用与卸载

- **`启动桌面挂件.cmd`**：恢复显示；菜单和托盘均可调整设置。
- **`停用自动跟随.cmd`**：停止挂件并删除本项目自启快捷方式，保留个人数据。
- **`卸载小龙娘.cmd`**：移除自动跟随、提醒 Hook 和 Codex 插件注册；保留设置、素材及代码文件。
- **`回滚本次安装.cmd`**：按本次安装的私有回执恢复上一版代码，保留新产生的个人数据。
- **`进入独立桌面.cmd`**：主动切换为不跟随 Codex 的桌面模式。

更新时重新运行安装器，个人素材和设置保留。用户主动退出后会保留暂停意图；可点击启动入口恢复，或更新时传入 `-Resume`。

## 额度、提醒与隐私

额度通过本机 Codex 官方 `account/rateLimits/read` 读取，30 秒缓存；仅显示账户实际返回的额度窗口。查询不会消耗重置卡。本机 token 统计只覆盖本机记录，不等于官方剩余 token。

菜单中的“用量明细”按模型展示 token 用量、API 等价费用估算、输出速度、请求数和缓存命中率，替代原来的近 7 天汇总列表。可切换今天、近 7 天和全部记录，日期按北京时间计算。统计基于 [codex-usage-dashboard v1.1.3](https://github.com/luyh7/codex-usage-dashboard/tree/v1.1.3)，首次打开时下载官方原生组件并核对 SHA256，网络下载使用 `HTTPS_PROXY` / `HTTP_PROXY`；支持 Windows x64、macOS arm64/x64 和 Linux x64。

组件运行在本机随机端口，只读取当前 `CODEX_HOME` 的活跃及归档日志，包含子代理独立用量；缓存、索引和组件保存于个人数据目录的 `usage-dashboard/` 下，关闭小龙娘时一并停止。不会复用或改动另外安装的 Dashboard。请求数统计有 token 增量的请求记录，重复快照不计数；纯生成速度（日志估算）为有首 token 计时的总输出（含推理）除以相应生成时长，排除首 token 等待、工具执行及用户等待，缺少首 token 计时不补算，并显示计时覆盖率；缓存命中率为缓存输入除以全部输入。费用不是订阅扣款，未知价格或缺失计时会明确标注，不作为零展示。

额度气泡上方小字显示“本周／5小时”，中间大字显示剩余额度，底部小字显示最近纯生成速度。完成气泡上方小字显示“本轮用量”，中间大字显示 token 总量，底部小字显示纯生成速度、API 估算美元费用和缓存命中率，例如“30t/s · 0.1$ · 78%命中”；不显示模型名、重置时间和解释文字，明细仍可在“用量明细”查看。多模型速度按生成 token 和生成时长加权，缓存命中率按输入量加权。API 估价复用 Dashboard v1.1.3 的历史价格表、上下文和速度档位规则；不等于订阅扣款或实际 API 账单，记录不完整或未知数据在气泡中显示“—”。

授权提醒来自 `PermissionRequest` Hook，并结合 Hook 的权限模式和本轮会话的审批设置过滤自动审查、无需询问及完全访问模式，避免把自动审批误报为需要你点头。审批设置读取 Hook 提供的本机会话记录，不以全局配置推断当前会话。部分桌面提问工具不触发 Hook，因此复用本机会话读取器识别真实提问及结构化回答；异步提交成功不等于用户已经回答。提醒状态只保存请求标识、类型、时间，不保存问题、答案或工具参数。Hook 不批准、拒绝或修改调用。

等待气泡可点击收起，同一请求刷新后也不重弹。授权状态在工具结果或回合结束时清除，长时间执行的工具可能在执行完成前仍保留气泡。官方机制见 [Hooks 文档](https://learn.chatgpt.com/docs/hooks)。

个人设置、认证、会话、IPC token、安装回执和运行日志不进入发布包。请勿在 Issue 中上传这些文件。详见 [安全说明](SECURITY.md)。

## 开发与构建

需要 Node.js 24+；发布打包需要 Python 3.10+。

```powershell
npm test
node scripts/check-package.mjs
python scripts/build-release.py --release-tag v0.1.4
```

生成的安装包、源码包、校验和与清单位于 `dist/`，不包含 Electron 下载缓存和个人数据。构建脚本不会上传或发布。开发请隔离 `CODEX_HOME` 与 `WHALE_HOME`，见 [贡献指南](AGENTS.md)。

Mac 界面与原生跟随测试可分别运行 `npm run smoke:mac`、`npm run smoke:mac-follow`。它们使用 `qa-output/` 下的隔离数据；原生测试创建临时 AppKit 窗口，覆盖移动、缩放、最小化、恢复、隐藏、暂停及宿主退出。先运行 `node scripts/install-desktop.mjs` 准备 Electron；如运行时安装在自定义数据目录，测试时传入相同的 `WHALE_HOME`。

## 来源与许可

基于 [Yang-huai406/Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public) 的 `codex-v0.4.0(fixed)`，原始项目为 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。感谢 [1llysviel 的 macOS PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128)。保留上游版权与贡献署名；本仓库从干净快照建立，不携带上游或本机开发提交历史。

代码使用 [MIT](LICENSE)。图片、动图和音频不因代码采用 MIT 自动取得同样的许可；素材说明见 [来源与改编记录](PROVENANCE.md)、[第三方声明](THIRD_PARTY_NOTICES.md)。这是非官方个人项目，与 OpenAI 无隶属关系。
