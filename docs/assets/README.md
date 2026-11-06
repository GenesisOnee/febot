# docs/assets

README 与发布素材用的图片。**SVG 是源文件，PNG 是导出的发布件**——改图先改 SVG，再重新导出。

| 文件 | 用途 | 尺寸 |
| --- | --- | --- |
| `architecture.svg` / `.png` | README「架构」章节 | 1200×760 |
| `comparison.svg` / `.png` | README「和直接用 Claude Code 的流程差异」 | 1200×820 |
| `ui-queue.png` | README「界面」：需求队列 | 1600×1000 |
| `ui-plan.png` | README「界面」：计划拍板弹窗 | 1600×1000 |
| `ui-review.png` | README「界面」：diff 审阅 | 1600×1000 |
| `social-preview.svg` / `.png` | GitHub 仓库 Social preview（网页上传） | 1280×640 |
| `demo-60s.gif` | README 首屏演示：队列 → 计划 → 待审 → diff | 740×463，60.8s，4.8 MB |

UI 截图来自 `yarn demo` 的演示数据，浏览器 1600×1000（2× 截取后缩到 1×）。重新截取时隐藏 `nextjs-portal`（Next 开发指示器）与右下角「演示模式」提示，不要裁掉页面内容。

导出方式：任意 SVG → PNG 工具均可（Inkscape、ImageMagick、浏览器截图、Electron `capturePage`）。
导出时保持 1× 缩放、白/深色背景按 SVG 自带背景，不要额外留白。

GIF 是用无头 Edge + CDP `Page.captureScreenshot` 按 160ms 节奏截帧、再量化成 64 色编码的（脚本不进仓库，见 `docs/promotion/recording-kit.md`）。重新录制时同样要隐藏 Next 开发指示器和「演示模式」浮层。