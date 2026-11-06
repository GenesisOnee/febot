# 演示素材录制手册（60 秒 GIF + 3~5 分钟视频）

> 现状：**60 秒 GIF 已完成**（`docs/assets/demo-60s.gif`，740×463，60.8s，4.8 MB，已进 README 首屏）；
> **3~5 分钟视频待录**，按第 3 节分镜手工录。
> 原则：**用 `yarn demo` + 示例仓录，不碰真实业务仓**；确实要展示真流水线时，用 `yarn demo:repo` 生成的最小仓。

## 1. 录制前

| 项 | 设置 |
| --- | --- |
| 浏览器 | Edge / Chrome，窗口 1600×1000，缩放 100% |
| 主题 | 浅色（截图与 README 一致） |
| 数据 | `yarn demo`（静态演示）或 `yarn demo:repo` 生成的最小仓 |
| 干扰项 | 关闭通知、书签栏、其他标签页；隐藏输入法候选框 |
| 隐私 | 不要出现真实仓库名、客户名、内网域名、token、个人姓名 |

工具：

- **Windows 11 自带**：`Win + G` → 开始录制，输出 MP4（够用，最省事）。
- **OBS Studio**：需要控制码率 / 多场景时用，输出 MP4。
- **剪辑**：剪映（免费）或 ffmpeg。本机没有 ffmpeg，装一个：

  ```bash
  winget install Gyan.FFmpeg
  ```

## 2. 60 秒 GIF 分镜（已按此录制）

| 时间 | 画面 | 操作 | 字幕 |
| --- | --- | --- | --- |
| 0–8s | 需求队列 | 停在队列页 | 需求排成队，不再散在十个会话里 |
| 8–15s | 展开需求 | 点开「表单必填校验补全」 | 每个需求都有状态和落点 |
| 15–23s | 计划拍板 | 点「计划」节点，弹出 AI 整理后的描述 | 人只做决策：确认 AI 整理出的计划 |
| 23–32s | 待审队列 | 打开待审队列，「有改动、未接受」的那条 | 待审队列：有改动、未接受 |
| 32–41s | diff 审阅 | 打开审阅页，看按文件的改动 | 人验收 diff；Agent 永远不 push |
| 41–60s | 收尾 | 回到队列，展开已完成 / 进行中的需求看节点状态 | 人定方案，Agent 团队写代码 |

> 全部用 `yarn demo` 的**静态演示数据**录，不要配「真实运行」的旁白。
> 字幕烧进画面（底部深色条），不依赖平台字幕。

### 2.1 已用的自动化录法（清屏、可重复）

无头 Edge + CDP：`Page.captureScreenshot` 每 160ms 取一帧（比 `Page.startScreencast` 的时间戳可靠），
同时按时间轴用 `Runtime.evaluate` 点开手风琴 / 计划节点、切路由；截图前移除
`nextjs-portal`（Next 开发指示器）、`[data-sonner-toast]` 和右下角「演示模式」浮层。
帧按 JPEG 去重 → sharp 缩到 740×463 并叠加字幕 → gifenc 量化 64 色（`rgb444`）编码，
每帧 delay 取相邻帧真实间隔，所以静止画面会合并成一帧长延时，整体压到 5 MB 以内。

手工录也行，按上表节奏走一遍再剪；手工录完用下面 4.1 的 ffmpeg 命令转 GIF。

## 3. 3~5 分钟视频分镜

| 段落 | 时长 | 内容 | 旁白要点 |
| --- | --- | --- | --- |
| 开场 | 0:00–0:20 | 黑底标题 + 一句话定位 | 不是「让 AI 写函数」，是把整条交付链跑起来 |
| 痛点 | 0:20–0:50 | 队列页 + 十个会话的对比示意 | 需求散、上下文丢、AI 改动不可控 |
| 安装 | 0:50–1:20 | 终端 `yarn setup` → `yarn demo` | 75 秒看到界面；不需要配置 |
| 需求进队 | 1:20–1:50 | 同步 / 新建任务、状态机 | 文件即接口：`tasks.md` |
| 计划拍板 | 1:50–2:30 | planner 出 plan.md，人工改描述并确认 | 先方案后代码；`decisions.md` 留审计链 |
| Agent 执行 | 2:30–3:20 | 启动流水线，展示会话 / 时间线 | planner / coder / reviewer 分工；blocker ≤2 轮 |
| 审阅合并 | 3:20–4:00 | diff 审阅、接受 / 驳回、提交 | Agent 不 push；远程写操作留给人 |
| 边界 | 4:00–4:30 | README 能力边界段落 | 同仓串行、只支持 Vue3、只支持 Claude Code |
| 收尾 | 4:30–4:45 | GitHub 页面 + Star / Issue 入口 | 开源 MIT，欢迎试用和提 Issue |

旁白建议写成逐字稿再录，语速控制在每分钟 220~260 字。

## 4. 后期

### 4.1 从 MP4 生成 60 秒 GIF

```bash
# 先剪出 60 秒，再转 GIF；880px 宽、12fps、128 色，通常能压到 5 MB 内
ffmpeg -ss 00:00:00 -t 60 -i demo.mp4 -vf "fps=12,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 docs/assets/demo-60s.gif
```

超过 5 MB 时依次降：`fps=10` → `max_colors=96` → `scale=760:-1`。

### 4.2 视频导出

- 1080p / 30fps / H.264 MP4，码率 4~6 Mbps。
- B 站：上传 MP4，封面用 `docs/assets/social-preview.png` 或单独做 16:9 封面。
- YouTube：英文字幕（SRT），标题用英文定位；中文版可另传一条。

## 5. 录完替换 README

1. ~~把 GIF 放到 `docs/assets/demo-60s.gif`~~ —— 已完成。
2. ~~取消 `README.md` / `README.en.md` 首屏的 `<img>` 注释~~ —— 已取消。
3. 视频录好后把链接加到 README「界面」或「快速开始」下方，并用
   [`utm-links.md`](utm-links.md) 里的 UTM 链接。
4. 更新本文件对应的分镜表（如果实际录制与计划不同）。
5. 提交前再检查一遍：GIF 里没有真实业务信息，文件 ≤5 MB。

## 6. 验收清单

- [x] GIF ≤ 5 MB（4.8 MB，740×463），循环播放无明显跳帧
- [x] 60 秒内讲清「队列 → 拍板 → 待审 → diff」四步
- [ ] 视频 3~5 分钟，有字幕，开头 10 秒能看懂是什么（待录）
- [ ] B 站 / YouTube 简介里有 GitHub 链接 + UTM
- [x] GIF 画面无真实客户名 / 仓库名 / token / 内网地址（全部来自 `example/demo`）