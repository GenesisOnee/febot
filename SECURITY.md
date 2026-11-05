# Security Policy / 安全策略

## Supported Versions / 支持版本

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a Vulnerability / 报告漏洞

请**不要**通过公开 Issue 报告安全问题。请使用 GitHub 的私密漏洞报告：

- https://github.com/Zombiesix/febot/security/advisories/new

报告中请包含：

- 受影响的版本 / commit
- 复现步骤
- 影响范围（例如：任意命令执行、凭据泄露、路径穿越）
- 如有可能，提供最小复现仓库或 PoC

我们会在 **3 个工作日内**确认收到，并在修复发布后公开致谢（如你愿意）。

## Scope / 范围

本项目的安全边界包括：

- `scripts/` 下的流水线脚本与状态机
- `.claude/agents/`、`.claude/commands/` 中的 Agent 定义与提示词
- `xiaoqian-manager` 的本地 Web 服务与 runner
- `code-indexer` / `swagger-mcp-server` 的本地 MCP 服务
- `desktop/` Electron 壳

## Sensitive Data / 敏感数据

- `febot.config.json` 含协作平台账号、密码密文和 cookie，**已被 gitignore**，请勿提交或粘贴到 Issue 中。
- `scripts/hindsight.env` 含模型 API Key，**已被 gitignore**。
- `om/` 已拆分为独立项目；其 `data.json`、`docs/` 也属于本地数据，不应提交。
- 如果你怀疑自己的凭据已泄露，请立即在对应平台轮换，并检查 git 历史。

## Known Boundaries / 已知边界

febot 会在本地执行 AI 生成的代码改动，并运行 lint/test。请仅在你信任的仓库和分支上使用，并在合并前人工审阅 diff。Agent 不会主动 push 远程，但本地脚本仍可能读写工作区文件。