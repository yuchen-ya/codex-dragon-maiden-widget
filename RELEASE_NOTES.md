# Codex 小龙娘 v0.1.3

修复自动审批时仍提示“这一步要你点头”的问题。支持 Windows 和 macOS。

## 更新内容

- `PermissionRequest` 发生在最终审批决定之前。现在结合 Hook 权限模式和当前会话的审批策略、审查者，过滤自动审查、无需询问及完全访问模式。
- 使用本轮会话记录及已应用的会话设置，避免全局配置、其他会话或历史回合影响判断。
- 保留手动授权提醒、提问提醒和同一请求只提醒一次的行为；Hook 不改变审批策略，也不会自动批准或拒绝调用。
- 增加真实 Hook 入口回归验证，修正 Mac CLI 路径测试在 Windows 下的路径分隔符假设，并检查新增运行时依赖是否随包分发。

## 安装与更新

下载 **Codex-Dragon-Maiden-v0.1.3.zip** 并完整解压：

- **Windows**：双击 **安装插件.cmd**。需要 Node.js 24+ / npm；安装器也会尝试使用 Codex 已有的 Node.js 24 运行时。
- **macOS**：双击 **安装 Mac 自动跟随.command**。需要 Node.js 24+ / npm 和 Xcode Command Line Tools。

已有用户使用相同入口更新，保留个人设置和素材。首次安装联网下载 Electron；不要在 ZIP 中直接运行。首次安装或 Hook 命令改变后，需要用户在 Codex Hooks 界面审核并信任 `interaction-hook.mjs`，安装器不会代替用户设置信任。

**Codex-Dragon-Maiden-v0.1.3-source.zip** 包含源码、测试和构建工具；另附 SHA-256 校验和与构建清单。

## 验证与隐私

- Windows / Node.js 24：516 项 Node 测试，513 项通过、3 项平台或可选测试跳过、零失败；其中 19 项交互提醒测试通过。
- 包元数据与依赖检查、9 项发布隐私测试、两个 ZIP 的完整性及隐私扫描通过。
- 本次未重新进行 macOS 硬件验收；既有 Apple Silicon、macOS 27.0.1 实测记录见 [验证记录](docs/VALIDATION.md)。
- 发布包排除个人配置、登录凭据、会话、IPC token、安装回执、日志、截图、测试输出和运行缓存。

代码采用 MIT，媒体按各自条款分发。上游和 macOS 贡献署名见 [来源记录](https://github.com/yuchen-ya/codex-dragon-maiden-widget/blob/v0.1.3/PROVENANCE.md)。本项目非 OpenAI 官方产品。
