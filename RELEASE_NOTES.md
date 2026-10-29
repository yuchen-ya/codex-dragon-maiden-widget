# Codex 小龙娘 v0.1.4

新增各模型用量统计和纯生成速度，简化额度及本轮用量气泡。支持 Windows 和 macOS。

## 更新内容

- “用量明细”接入 [codex-usage-dashboard 1.1.3](https://github.com/luyh7/codex-usage-dashboard/tree/v1.1.3)，按模型展示 token、API 等价费用、纯生成速度、请求数和缓存命中率，可切换今天、近 7 天和全部记录。
- 纯生成速度＝有首 token 计时的输出（含推理）÷ 对应生成时长，排除首 token 等待、工具执行和用户等待；缺失计时不补算，显示覆盖率。缓存命中率＝缓存输入÷全部输入；费用按历史 API 价格及上下文、速度档位估算，不代表订阅扣款或实际 API 账单。
- 额度气泡：上方周期，中间剩余额度，底部最近速度。完成气泡：上方“本轮用量”，中间大字 token 数，底部速度、美元估价、命中率。多模型按 token 和时长合并，未知数据明确显示“—”。
- 统计组件首次使用时联网下载并核对 SHA-256，仅在本机运行，缓存放入个人数据目录；随小龙娘关闭。清理旧展示分支和过渡兼容逻辑。

## 安装与更新

下载 **Codex-Dragon-Maiden-v0.1.4.zip** 并完整解压：

- **Windows**：双击 **安装插件.cmd**。需要 Node.js 24+ / npm；安装器也会尝试使用 Codex 已有的 Node.js 24 运行时。
- **macOS**：双击 **安装 Mac 自动跟随.command**。需要 Node.js 24+ / npm 和 Xcode Command Line Tools。

已有用户使用相同入口更新，保留个人设置和素材。首次安装联网下载 Electron；不要在 ZIP 中直接运行。首次安装或 Hook 命令改变后，需要用户在 Codex Hooks 界面审核并信任 `interaction-hook.mjs`，安装器不会代替用户设置信任。

**Codex-Dragon-Maiden-v0.1.4-source.zip** 包含源码、测试和构建工具；另附 SHA-256 校验和与构建清单。

## 验证与隐私

- Windows / Node.js 24：完整 Node 测试、真实原生统计组件及 Electron 气泡检查，结果见 [验证记录](docs/VALIDATION.md)。
- 包元数据与依赖检查、9 项发布隐私测试、两个 ZIP 的完整性及隐私扫描通过。
- 本次未重新进行 macOS 硬件验收；既有 Apple Silicon、macOS 27.0.1 实测记录见 [验证记录](docs/VALIDATION.md)。
- 发布包排除个人配置、登录凭据、会话、IPC token、安装回执、日志、截图、测试输出和运行缓存。

代码采用 MIT，媒体按各自条款分发。上游和 macOS 贡献署名见 [来源记录](https://github.com/yuchen-ya/codex-dragon-maiden-widget/blob/v0.1.4/PROVENANCE.md)。本项目非 OpenAI 官方产品。
