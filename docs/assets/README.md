# docs/assets

README 与发布素材用的图片。**SVG 是源文件，PNG 是导出的发布件**——改图先改 SVG，再重新导出。

| 文件 | 用途 | 尺寸 |
| --- | --- | --- |
| `architecture.svg` / `.png` | README「架构」章节 | 1200×760 |
| `social-preview.svg` / `.png` | GitHub 仓库 Social preview（网页上传） | 1280×640 |
| `demo-60s.gif` | README 首屏演示（**待录制**，见路线图 P0/传播素材） | 建议 ≤ 880px 宽、≤ 5 MB |

导出方式：任意 SVG → PNG 工具均可（Inkscape、ImageMagick、浏览器截图、Electron `capturePage`）。
导出时保持 1× 缩放、白/深色背景按 SVG 自带背景，不要额外留白。

> GIF 录好后放在这里，并取消 `README.md` / `README.en.md` 首屏里被注释的 `<img>` 那两行。