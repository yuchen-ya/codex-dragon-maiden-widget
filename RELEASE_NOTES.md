# Codex 小龙娘 v0.1.13

尾巴可以拉直和回弹，Jev 同次判断增加本地匿名情境统计。

## 更新

- **尾巴形变**：尾根固定，拉扯时逐段展开弧度，松手回卷、轻摆后停稳；重抓自然接续，静止后停止绘制。修正镜像/贴边受力、透明细缝及小尺寸尾尖出界，点击区域随形变更新。
- **互动节奏**：10 秒内第一次拉扯安静，第二、第三次表达不满，随后 20 秒不回应尾巴互动。收起后继续完全免打扰；拖拽或 1.2 秒内点击 4 次恢复。
- **Jev 匿名统计**：同次请求标注心情和认同、商量、反对、请教、继续等意图，本地按天累计，低置信度单独记录。有效返回即使没弹气泡也统计；调用前跳过及失败不计，不追加云端请求补齐、不回溯历史。

Jev 默认关闭，计费按服务商规则；统计只代表实际分析样本，不是心理诊断。短文字仍发送给所选云端服务，自动过滤不能保证没有隐私泄漏。[功能与隐私说明](https://github.com/yuchen-ya/codex-dragon-maiden-widget/blob/v0.1.13/docs/INTENT-AWARENESS.md)

## 安装

下载 **Codex-Dragon-Maiden-v0.1.13.zip**，完整解压后运行 Windows 的 `安装插件.cmd` 或 macOS 的 `安装 Mac 自动跟随.command`。需已登录的 Codex 桌面端、Node.js 24+ 和 npm；Mac 另需 Xcode Command Line Tools，首次安装需要联网。

更新保留设置、素材和个人台词库。个人台词库不会自动覆盖为新版模板；需要新默认措辞时可按 [编辑说明](https://github.com/yuchen-ya/codex-dragon-maiden-widget/blob/v0.1.13/docs/DIALOGUE-LIBRARY.md) 合入，新的互动节奏直接生效。首次安装或命令改变后，请在 Codex Hooks 界面审核提醒 Hook。

安装包及 `-source.zip` 均附 SHA-256 校验文件和构建清单；个人配置、认证、会话、日志、统计和测试截图不进入发布包。

## 验证

595 项 Node 测试：592 通过、3 跳过；26 项尾巴交互检查、40 张形变抽帧、12 项 Jev Electron 检查、13 项发布隐私测试与包检查通过。[详细记录](https://github.com/yuchen-ya/codex-dragon-maiden-widget/blob/v0.1.13/docs/VALIDATION.md)

本轮未重新进行 macOS 硬件验收；保留既有 Apple Silicon 验证记录，Intel 未实测。代码 MIT，媒体按各自条款分发，保留上游和 macOS 贡献署名。非 OpenAI 官方产品。
