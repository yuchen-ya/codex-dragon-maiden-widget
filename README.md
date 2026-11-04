# Codex 小龙娘

Windows / macOS 桌宠，随 Codex 窗口显示、隐藏，查看额度并提醒提问与授权。

[下载最新版](https://github.com/yuchen-ya/codex-dragon-maiden-widget/releases/latest) · [更新记录](CHANGELOG.md) · [验证记录](docs/VALIDATION.md)

<img src="assets/dragon-maiden-bust-v1.png" width="180" alt="小龙娘">

## 功能

- 点击角色查看订阅额度，菜单查看模型用量、生成速度和 API 费用估算。
- 提问、授权和完成提醒；两套形象，支持拖动、缩放、翻转和自定义素材。
- 点击尾尖收起，完全免打扰；单击摇尾，拖拽或 1.2 秒内点 4 次展开。
- 自定义称呼，默认“老大”；[个人台词库](docs/DIALOGUE-LIBRARY.md) 可直接编辑，更新时保留。
- **Jev 情境反应默认关闭**：开启后，根据新发送的短文字简短接话，无聊天窗口。支持自选兼容服务及直连 / HTTP(S) 代理。

## 安装

先安装并登录 Codex 桌面端，准备 **Node.js 24+ 和 npm**；安装器也会尝试复用 Codex 的 Node 运行时。

1. 从 [Release](https://github.com/yuchen-ya/codex-dragon-maiden-widget/releases/latest) 下载 **安装 ZIP**（非 source），完整解压；首次安装需要联网。
2. Windows 运行 `安装插件.cmd`；macOS 运行 `安装 Mac 自动跟随.command`。Mac 还需 Xcode Command Line Tools（`xcode-select --install`）。
3. 在 Codex **Hooks** 界面（CLI 输入 `/hooks`）审核并信任 `interaction-hook.mjs`，启用授权提醒；命令改变后需重新审核。

macOS 已在 Apple Silicon 实测，Intel 尚未实测。Mac 请保留解压目录，移动后重新安装。

## 使用与隐私

菜单可调整外观、称呼、声音、气泡和 Jev 配置；默认静音。更新时重新运行新版安装入口。Windows 卸载运行 `卸载小龙娘.cmd`，保留个人设置和素材。

订阅额度来自官方账户接口，无需 API 密钥。用量与 API 估价由本机统计，**不等于订阅扣款或实际账单**；未知数据显示“—”。

开启 Jev 后，最多 300 字的合格短文字会发送给所选云端服务，**产生计费并可能影响工作效率**。图片不上传；长数字和疑似密钥会先过滤，但**不能保证没有隐私泄漏**。输入框自动草稿暂不可读取，不声称识别推荐采纳。详见 [功能说明](docs/INTENT-AWARENESS.md)。

配置、认证、会话和内部日志不进入发布包，请勿上传至 Issue。见 [安全说明](SECURITY.md)。

## 开发与许可

Node.js 24+；打包另需 Python 3.10+。

```sh
npm test
node scripts/check-package.mjs
python scripts/build-release.py --release-tag v0.1.10
```

产物位于 `dist/`，构建不会自动发布。开发约定见 [AGENTS.md](AGENTS.md)。

基于 [Codex-Whale-Public](https://github.com/Yang-huai406/Codex-Whale-Public) 与 [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，感谢 [1llysviel 的 macOS PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128)。用量组件来自 [codex-usage-dashboard](https://github.com/luyh7/codex-usage-dashboard/tree/v1.1.3)。

代码采用 [MIT](LICENSE)，媒体按各自条款分发，见 [来源记录](PROVENANCE.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。非 OpenAI 官方产品。
