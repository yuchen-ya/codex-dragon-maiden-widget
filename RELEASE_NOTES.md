# Codex 小龙娘 v0.1.0

首个独立安装版本。完整解压发布包后双击 `安装插件.cmd`，安装器会下载 Electron、注册 Codex 插件和登录自启快捷方式。首次安装需联网、Codex 桌面端与 Node.js 24+；也会尝试复用 Codex 自带的 Node 运行时。

安装后在 Codex Hooks 界面信任 `interaction-hook.mjs` 提醒命令。该步骤由用户完成，不改变工具审批策略。

已验证 Windows 原生窗口跟随、额度读取、角色切换、提问与真实授权提醒、窗口缩放及最小化恢复。Mac 代码保留，未做硬件验收。重启与退出 Codex 的可见性受原生监督器控制。

安装包不含个人配置、凭据、日志、截图、Electron 缓存和测试输出。`dist/` 的本地构建不等于已发布到 GitHub。

代码使用 MIT；媒体按各自条款分发。原项目及 macOS 贡献署名见 [PROVENANCE.md](PROVENANCE.md)。
