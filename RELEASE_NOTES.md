# Codex 小龙娘 v0.1.14

修复身体按压时尾巴不跟随，以及拖尾时急折、挤皱和贴图翻面的问题。

## 更新

- 展开尾巴与身体共用按压变换，尾根保持连接；命中及拖拽坐标同步处理缩放和镜像。
- 尾巴改为平滑限幅的连续形变，牵拉范围随角色大小变化，松手轻摆回位；保留原素材、收起动画及互动节奏。
- 修正小尺寸尾尖坐标的取整误差，清理旧关节算法、无用采样及冗余防御判断。

## 安装

下载 **Codex-Dragon-Maiden-v0.1.14.zip**，完整解压后运行 Windows 的 `安装插件.cmd` 或 macOS 的 `安装 Mac 自动跟随.command`。需要已登录的 Codex 桌面端、Node.js 24+ 和 npm；Mac 另需 Xcode Command Line Tools，首次安装需要联网。

更新保留设置、素材、个人台词库及 Jev 配置。首次安装或提醒 Hook 命令改变后，由用户在 Codex Hooks 界面审核并信任。

安装包及 `-source.zip` 均附 SHA-256 校验文件和构建清单；个人配置、认证、会话、日志、统计、录屏和测试截图不进入发布包。

## 验证

596 项 Node 测试：593 通过、3 跳过；26 项隔离 Electron 交互回归、按压连接与拖尾形变专项检查、13 项发布隐私测试及包检查通过。覆盖左右镜像、最小/最大尺寸、收起/唤醒、贴边牵拉、回弹、像素命中和极端受力下网格不翻面。[详细记录](https://github.com/yuchen-ya/codex-dragon-maiden-widget/blob/v0.1.14/docs/VALIDATION.md)

Electron 交互检查使用合成鼠标输入。本轮未重新进行 macOS 硬件验收，保留既有 Apple Silicon 验证记录，Intel 未实测。代码 MIT，媒体按各自条款分发；来源与贡献署名见 [来源记录](https://github.com/yuchen-ya/codex-dragon-maiden-widget/blob/v0.1.14/PROVENANCE.md)。非 OpenAI 官方产品。
