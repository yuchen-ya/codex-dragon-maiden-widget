# 素材来源

## 小龙娘形象

`assets/dragon-maiden-bust-v1.png` 与 `dragon-maiden-bust-v1-a.png` 为 AI 辅助创作的白龙娘透明半身图。主要特征为银白发、紫瞳、双角、白紫服饰；采用适合小尺寸桌宠的头身比例、粗描边和平涂。两张分别为第一版与 A 版，可在角色菜单切换。

这是非官方二创，不宣称拥有参考角色或相关商标权。代码的 MIT 许可不自动涵盖角色形象与媒体内容。

`assets/dragon-maiden-tail-v1.png` 为 2026-11-04 经用户确认的 AI 辅助创作透明尾巴，以第一版形象为画风与配色参考，由内置 imagegen 生成。展开时露出尾尖作为收起入口。适用上述角色媒体权利说明。

`assets/dragon-maiden-hide-v7.webp`、`dragon-maiden-appear-v7.webp` 结合本机 MiniMax H3 的身体动作与程序控制的尾巴。imagegen 补画全身、低头及无尾背部参考，H3 身体帧通过用户已安装的 **H3 Transparent Video - SatoDive** 节点处理透明。收起采用有效的身体帧 0–23，再保持最后的背部姿势向下移动，舍弃模型后段自行长出的尾巴；尾巴始终使用上述已确认原图，沿连续弧长曲线变形，中段先舒展、尾尖延迟卷下，再小幅回摆。保留先向身体中间归拢、再弧形下收的轨迹，并用身体遮挡尾根，避免圆帽外露、鳞片漂移或翻面。出现时先收回尾尖，再露出头部与半身。

最终以 FFmpeg 压缩为一次播放的透明 WebP，两段合计约 1.41 MB，每段约 1.17 秒。0.1.7 起静止、摇动及牵拉均使用完整的 `dragon-maiden-tail-v1.png`，围绕真实根部变形，由身体或窗口边缘遮住根部；不再移动一张裁断的尾尖。`dragon-maiden-tail-hide-v8.webp`、`dragon-maiden-tail-appear-v8.webp` 是从同一曲线导出的完整尾巴独立动画，配套 `dragon-maiden-tail-motion-v8.json` 记录逐帧尖端位置，供侧边动作维持连续衔接。制作参考、工作流、原始帧、逐帧检查、提示词和分层 Aseprite 工程留在忽略目录 `qa-output/collapse-animation/`。不分发模型、权重或 ComfyUI 节点代码，日常运行无需 ComfyUI。

上述 H3 动作匹配第一版底部静止半身图；侧边与悬空位置使用程序编排的直立探身、贴边动作及独立尾巴动画。A 版及自定义角色保留原图，避免播放其他形象的脸。透明像素命中补偿完整尾巴的长宽比、镜像及根部变换，并保护连击位置。

`assets/dragon-maiden-petpet.gif` 将第一版原图与上游 `bubble-petpet.gif` 中逐帧提取的手掌合成，保留手掌的模糊质感与原动作速度。此文件为改编素材，原手掌素材的权利归属不变。

## 上游媒体与依赖

现有气泡 GIF 与按压音频来自上游项目，按原媒体条款 as-is 分发，保留原权利归属；不授予额外的独立提取、商业使用或再许可权。详见 [来源记录](../PROVENANCE.md)、[第三方声明](../THIRD_PARTY_NOTICES.md) 和 [上游项目](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。

## 文案

[quote-sources.json](quote-sources.json) 记录运行时 52 条文案及其公开出处。原帖及相关角色的权利属于各自作者，本项目保留出处以便核对。
