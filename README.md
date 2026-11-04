# Codex 小龙娘

支持 **Windows 和 macOS** 的 Codex 桌宠，随 Codex 窗口显示、隐藏，查看额度并提醒提问与授权。

[下载最新版本](https://github.com/yuchen-ya/codex-dragon-maiden-widget/releases/latest) · [更新记录](CHANGELOG.md) · [验证记录](docs/VALIDATION.md)

![小龙娘](assets/dragon-maiden-bust-v1.png)

## 功能

- **额度与用量**：点击角色查看剩余额度和最近速度；菜单查看各模型 token、API 估价、请求数和缓存命中率，每轮结束弹出简洁统计。
- **提问与授权提醒**：显示会话短名称，同一请求不重复提醒，不代替用户回答或授权。
- **外观与交互**：两套形象，支持拖动、缩放、翻转、自定义素材、随机文案和摸头 GIF；默认静音，可在菜单开启音效。
- **收起陪伴**：点击尾尖收起，只留小尾尖；侧边中央或悬空放置时，会朝最近的窗口边缘藏起来，展开后回到原位。收起时完全免打扰。单击轻摆，拖拽或 1.2 秒内连续点击 4 次恢复；展开动画结束后才接专属短句。展开时可按住尾巴轻拉，完整尾巴绕固定根部弯动、松手回弹。
- **动作素材**：第一版底部沿用已确认的 H3 身体与受控尾巴透明动画；侧边使用保持直立的探身、贴边动作和独立柔性尾巴动画。A 版及自定义形象保留自身角色图片。桌宠运行时不依赖 ComfyUI 或视频模型。

## 安装

先安装并登录 Codex 桌面端，准备 **Node.js 24+ 和 npm**；安装器也会尝试复用 Codex 的 Node 运行时。macOS 还需 Xcode Command Line Tools（`xcode-select --install`）。

1. 下载 Release 中的安装 ZIP，完整解压到固定目录，首次安装需要联网。
2. 按系统运行入口，安装后自动启动：

   | 系统 | 安装入口 |
   | --- | --- |
   | Windows | `安装插件.cmd` |
   | macOS | `安装 Mac 自动跟随.command` |

3. 在 Codex **Hooks** 界面（CLI 输入 `/hooks`）审核并信任含 `interaction-hook.mjs` 的提醒 Hook；命令改变后需重新审核。

macOS 已在 Apple Silicon 实测，Intel Mac 尚未实测。Mac 直接使用解压目录运行，移动后需重新安装。

## 使用、更新与卸载

菜单可切换自动跟随和独立桌面模式；点击气泡切换内容或收起。手动退出后，通过“启动桌面挂件”恢复。

开发版菜单新增 **Jev 服务与网络**：可选 OpenRouter、TypeSafe 官方或其他兼容 Decisions / System One 的服务，自行填写完整接口地址、模型及密钥环境变量名。网络默认直连，也可指定 HTTP(S) 代理地址和端口；选用代理后，失败不会改走直连。密钥只从环境变量读取，不保存到配置文件，新增环境变量后需重启桌宠。

“测试连接”使用当前表单发送一条固定测试句，会产生少量模型费用，不上传聊天、不保存表单。发送后情境反应默认关闭，需要单独勾选并保存；关闭时不启动本功能的消息监听。开启后只分析新发送的纯文本短消息（最多 300 个 Unicode 码点），在有强烈情绪和合适固定台词时短暂回应，不提供聊天窗口；关闭、隐藏、重要提醒或超时都会废弃旧反应。

当前 Codex 输入框自动草稿没有已接通的可读展示接口，因此实际运行只分析用户短消息，不会根据猜测触发“采纳推荐后的得意”。推荐快照配对规则已实现，采集端仍待接通。Jev 设置仅影响这项可选反应，不改变额度查询等现有网络连接。

- **更新**：解压新版并重新运行安装入口，保留设置和素材。
- **停用／回滚**：运行“停用自动跟随”或对应的回滚入口；安装失败时保留私有回滚回执。
- **Windows 卸载**：运行 `卸载小龙娘.cmd`，移除自启、提醒 Hook 和插件注册，保留设置、素材及代码。

## 统计与隐私

额度来自 Codex 官方账户接口，无需 API 密钥，查询不消耗重置卡。本机用量由 [codex-usage-dashboard](https://github.com/luyh7/codex-usage-dashboard/tree/v1.1.3) 统计，包含子代理，支持今天、近 7 天及全部记录，按北京时间划分。

**纯生成速度**＝有首 token 计时的输出（含推理）÷ 对应生成时长，排除首 token 等待、工具执行和用户等待；缺少计时不补算。**缓存命中率**＝缓存输入÷全部输入。费用按 API 价格估算，不等于订阅扣款或实际账单，未知数据显示“—”。

统计组件首次使用时下载并校验，仅在本机运行，随小龙娘关闭。个人配置、认证、会话和日志不进入发布包，也请勿上传至 Issue，见 [安全说明](SECURITY.md)。

## 开发

需要 Node.js 24+；打包另需 Python 3.10+。

```sh
npm test
node scripts/check-package.mjs
python scripts/build-release.py --release-tag v0.1.9
```

产物位于 `dist/`，构建脚本不会发布。开发隔离与平台测试见 [贡献指南](AGENTS.md)。

## 来源与许可

基于 [Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public)，原始项目为 [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，感谢 [1llysviel 的 macOS PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128)。

代码采用 [MIT](LICENSE)，媒体遵循各自条款，见 [来源记录](PROVENANCE.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。本项目非 OpenAI 官方产品。
