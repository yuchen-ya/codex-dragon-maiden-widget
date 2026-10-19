# Codex 小龙娘

跟随 Codex 桌面窗口的小龙娘桌宠：查看订阅额度，在需要回答或授权时提醒你。

![第一版](assets/dragon-maiden-bust-v1.png)

## 功能

- 点击角色查看 Codex 官方订阅额度，再点气泡切换文案、收起；不需要 API 密钥。
- 第一版、A 版两套形象，支持拖动、缩放、左右翻转、自定义素材和气泡。
- 提问显示“我在等你回答”，授权显示“这一步要你点头”；同一请求不重复提醒。
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

## 使用与卸载

- **`启动桌面挂件.cmd`**：恢复显示；菜单和托盘均可调整设置。
- **`停用自动跟随.cmd`**：停止挂件并删除本项目自启快捷方式，保留个人数据。
- **`卸载小龙娘.cmd`**：移除自动跟随、提醒 Hook 和 Codex 插件注册；保留设置、素材及代码文件。
- **`回滚本次安装.cmd`**：按本次安装的私有回执恢复上一版代码，保留新产生的个人数据。
- **`进入独立桌面.cmd`**：主动切换为不跟随 Codex 的桌面模式。

更新时重新运行安装器，个人素材和设置保留。用户主动退出后会保留暂停意图；可点击启动入口恢复，或更新时传入 `-Resume`。

macOS 保留上游兼容实现与 `.command` 入口，当前版本尚未进行 Mac 实机验收；Windows 是本次验证的平台。

## 额度、提醒与隐私

额度通过本机 Codex 官方 `account/rateLimits/read` 读取，30 秒缓存；仅显示账户实际返回的额度窗口。查询不会消耗重置卡。本机 token 统计只覆盖本机记录，不等于官方剩余 token。

授权提醒来自 `PermissionRequest` Hook。部分桌面提问工具不触发 Hook，因此复用本机会话读取器识别真实提问及结构化回答；异步提交成功不等于用户已经回答。提醒状态只保存请求标识、类型、时间，不保存问题、答案或工具参数。Hook 不批准、拒绝或修改调用。

等待气泡可点击收起，同一请求刷新后也不重弹。授权状态在工具结果或回合结束时清除，长时间执行的工具可能在执行完成前仍保留气泡。官方机制见 [Hooks 文档](https://learn.chatgpt.com/docs/hooks)。

个人设置、认证、会话、IPC token、安装回执和运行日志不进入发布包。请勿在 Issue 中上传这些文件。详见 [安全说明](SECURITY.md)。

## 开发与构建

需要 Node.js 24+；发布打包需要 Python 3.10+。

```powershell
npm test
node scripts/check-package.mjs
python scripts/build-release.py --release-tag v0.1.0
```

生成的安装包、源码包、校验和与清单位于 `dist/`，不包含 Electron 下载缓存和个人数据。构建脚本不会上传或发布。开发请隔离 `CODEX_HOME` 与 `WHALE_HOME`，见 [贡献指南](AGENTS.md)。

## 来源与许可

基于 [Yang-huai406/Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public) 的 `codex-v0.4.0(fixed)`，原始项目为 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。感谢 [1llysviel 的 macOS PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128)。保留上游版权与贡献署名；本仓库从干净快照建立，不携带上游或本机开发提交历史。

代码使用 [MIT](LICENSE)。图片、动图和音频不因代码采用 MIT 自动取得同样的许可；素材说明见 [来源与改编记录](PROVENANCE.md)、[第三方声明](THIRD_PARTY_NOTICES.md)。这是非官方个人项目，与 OpenAI 无隶属关系。
