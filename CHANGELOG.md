# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。
`0.x` 期间可能有破坏性变更，会在对应版本的 Release Notes 里明确标注。

## [0.1.0] - 2026-11-06

首个公开版本：可克隆、可跑通、可传播。

### Added

- **多 Agent 流水线**：`/pipeline` 剧本 + orchestrator / planner / coder / reviewer 分离；
  文件即接口（`state.json` / `plan.md` / `decisions.md`），人工卡计划、文件白名单、diff 三道门禁。
- **工作台** `xiaoqian-manager`：需求队列、状态机、计划拍板、diff 审阅、工时回填；
  跨仓并行、同仓串行（开工门禁 + `file-lock.md` 仲裁）。
- **零配置演示**：`yarn demo` 使用 `example/demo/` 静态夹具，写 `.febot/demo-workspace/`；
  端口占用自动顺延，独立 `.next-demo` 构建目录，可与 `yarn dev` 并存。
- **最小示例仓**：`yarn demo:repo` 把 `example/demo-repo/` 生成到 `.febot/demo-repo`，Quick Start 不依赖业务仓。
- **事实层**：`code-indexer` 现算 Vue3 代码事实（路由 / 组件树 / API 域 / store / 权限 / 存储）；
  `swagger-mcp-server` 提供实时 API 文档。
- **记忆层（可选）**：`docker-compose.yml` 一键起 Hindsight，按 bank 隔离研发经验与业务知识。
- **桌面端（可选）**：Electron 壳，把工作台与 runner 装成双击即用的 Windows 应用。
- **文档**：中英双语 README、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、ROADMAP、安装耗时记录。
- **协作基建**：Issue 模板（Bug / Feature / Usage）、PR 模板、8 个 `good first issue`、
  CI（code-indexer / desktop typecheck、lint、单测、`yarn setup` 冒烟）。
- **传播素材**：架构图、流程对比图、三张界面截图；GIF 与演示视频待录制。

### Changed

- 每一类常见错误给出「原因 + 下一步」：runner 离线、配置缺失 / JSON 损坏、仓库或分支未注册、
  协作平台凭据缺失、任务来源未知、演示模式写操作。
- 许可证改为 MIT；移除了内部业务标识、示例数据与无关笔记。

### Known limitations

- **同仓串行**：同一仓库同一时间只跑一条流水线（为了随时能起 dev server 验收）；
  跨仓可并行。
- **只支持 Vue 3 仓库**；runner 目前只有 Claude Code。
- **Agent 不 push**：提交、推送、合并都必须由人完成。
- Windows 优先；其他平台可跑，但未做完整验证。
- 演示模式为静态数据：启动流水线、发消息、提交代码会返回原因与下一步，不会真的执行。