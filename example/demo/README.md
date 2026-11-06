# demo / 演示数据

`yarn demo`（或 `FEBOT_DEMO=1`）使用的静态夹具。**入库、只读**，不要在这里放真实业务数据。

| 文件 | 内容 |
| --- | --- |
| `febot.config.json` | 演示配置：`repoRoot: ../../.febot`、一个 `demo-repo`、`dev` 分支；`defaults` 也指向 `dev`，所以设置弹窗不会自动弹出 |
| `tasks.json` | 5 个任务：待审、等待计划确认、编码中、未开始、已完成各一个 |
| `runs.json` | 3 个 run（done / needs_input / running）+ 对应 diff、时间线、终端快照 |

## 约定

- `runs.json` 里的时间可以写 `@-38m` / `@-2h`，服务端加载时换算成绝对时间，演示永远不会「过期」。
- `patches` 是标准 unified diff，直接交给 diff2html 渲染；文件变更以这里为准。
- 演示期间点「接受 / 驳回」只记在 Next 进程内存里，刷新页面仍保留，重启 `yarn demo` 复位。
- 启动流水线、发消息、提交代码会返回明确的「演示模式不可用」提示，不会落盘或执行 git。

## 修改后自检

```bash
node -e "JSON.parse(require('fs').readFileSync('example/demo/runs.json','utf8'))"
yarn demo
```

改 `tasks.json` 时保持阶段 key 为 `planer` / `coder` / `deploy`，否则会被
`normalizeStages` 重排。
