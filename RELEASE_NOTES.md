# Codex 小龙娘 v0.1.2

本次更新完成 macOS 适配，并保留现有 Windows 安装流程。

## 更新内容

- 修复 Mac 长目录和中文路径下的本地通信，保留私有目录权限和认证。
- 修复 Finder 双击入口的执行权限，自动选择 Node.js 24+，支持 Homebrew、nvm、Volta、mise 及可用的 Codex Node 运行时。
- 支持 Mac 桌面端自带的不同 CLI 布局，后台额度读取不依赖终端 PATH；自定义 CODEX_HOME / WHALE_HOME 会写入 LaunchAgent。
- 修复设置界面的键盘焦点、Esc 关闭，以及切换应用、移动、缩放、最小化和恢复窗口时的跟随行为。
- 原生窗口探测器通过 RunLoop 刷新前台状态；跟随模式不会浮在无关应用上方，独立桌面模式可在 Codex 退出后继续显示。
- 修复回滚到先前停用自启状态时的报错和启动项残留。

## 安装与更新

下载 **Codex-Dragon-Maiden-v0.1.2.zip** 并完整解压到固定目录：

- **macOS**：双击 **安装 Mac 自动跟随.command**。需要 Node.js 24+ / npm 和 Xcode Command Line Tools；未安装编译工具时，先运行 `xcode-select --install`。首次安装联网下载 Electron。
- **Windows**：双击 **安装插件.cmd**。已有用户使用同一入口更新，保留个人设置和素材。

首次安装或 Hook 命令改变后，需要用户在 Codex Hooks 界面审核并信任 `interaction-hook.mjs`。安装器不会代替用户设置信任或授权。

**Codex-Dragon-Maiden-v0.1.2-source.zip** 包含源码、测试和构建工具。另附 SHA-256 校验和与构建清单。

## 验证与隐私

- 512 项 Node 测试：505 项通过、7 项平台或可选测试跳过、零失败。
- 8 组 Mac 界面测试和 8 组原生 AppKit 跟随测试通过；真实 Codex 账户额度读取成功。
- 隔离环境中实测 LaunchAgent 安装、运行、停用和回滚；9 项发布隐私测试通过。
- 两个 ZIP 均排除个人配置、登录凭据、会话、IPC token、安装回执、日志、截图、测试输出、运行缓存和 Git 历史；媒体中的非渲染元数据会在打包时清理。

Mac 实测环境为 Apple Silicon、macOS 27.0.1、Retina 2x。Intel、外接多屏、全屏 Spaces 和重启后的自启尚未实测；Windows 变更通过公共自动测试，本次未重新进行 Windows 实机验收。

代码采用 MIT，媒体按各自条款分发。上游和 macOS 贡献署名见 [来源记录](https://github.com/yuchen-ya/codex-dragon-maiden-widget/blob/v0.1.2/PROVENANCE.md)。本项目非 OpenAI 官方产品。
