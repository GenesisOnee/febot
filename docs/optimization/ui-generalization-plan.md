# 小前工作台通用化改造计划书

> 版本：v4（2026-11-04）
> 范围：`xiaoqian-manager`（Next.js 工作台）+ 必要的 `scripts/` 配置读取改造（`om/` 不在此次范围）
> 目标：三栏工作台、可视化配置、任务源可插拔、阶段步骤解耦、代码提交与完成拆分、配置与任务字段精简
> 状态：方案已确认，待实施
>
> v4 变更（配置与任务字段精简）：
> - 配置从 `repos` / `projectMap` / `branches` / `jenkins.jobs` 多张映射表，收敛为**一份 `repositories[]` 仓库登记表**；其余视图全部派生。
> - Jenkins 只保留全局 `jenkinsBase` + 每仓 `jenkinsJob`，不再维护 `jenkins.jobs` 映射表。
> - `devplatform.appNames` / `codeNameMap` 属 `om/` 系统，本计划不纳入登记表、不改写、不迁移（`om/` 保持独立）。
> - 任务字段删除 9 个：`leval`、`taskType`、`developmentHour`、`factFinish` 四个常量/空字段，以及不再需要的 `maxHour`、`planStart`、`planEnd`、`factStart`、`version`；其余展示字段改为可选。
> - `scripts/`、`xiaoqian-manager/` 统一按新登记表派生，不再各自维护映射；`om/` 不在此次改造范围。
>
> v3 变更（按评审结论收敛）：
> - 登录/注册推迟到后续阶段，首期只保留左下角占位，不做接口与鉴权。
> - 不再兼容旧配置：配置改为全新的 `repositories[]` 登记表，所有读取方一次改完。
> - 右栏彻底去掉时间线，只保留标题、终端、操作条。
> - 驳回只在独立审阅页；右栏不提供驳回。
> - 代码提交成功后自动标记“已接受”。
> - 首期不包含桌面端改造与验收。
> - 明确：一个仓库可对应多个项目名；自定义脚本仅支持 Node；本机首次做完整初始化。

---

## 0. 结论摘要

本次改造分五条主线，A–D 为当前范围，E 为后续阶段：

| 主线 | 内容 | 优先级 |
|---|---|---|
| A. 工作台布局 | 左侧导航/通知、中间任务列表、右侧常驻会话，审阅保持独立页签 | P0 |
| B. 可视化配置 | 设置弹窗：仓库根目录扫描、统一仓库登记表（仓库/项目/Jenkins/看板名）、nextDevOrigins、hindsight | P0 |
| C. 任务来源解耦 | `TaskSource` 适配器；内置协作平台 + 用户上传自定义脚本文件夹 | P2 |
| D. 步骤解耦 | 阶段定义/阶段处理器注册表；去掉 API 里写死的 `if (stageKey === "deploy")` | P3 |
| E. 身份 | 首期不做登录，仅保留左下角占位；登录/注册列入后续阶段 | 后续 |

关键设计决策（已确认）：

1. **首期不做登录**：工作台默认本机单用户模式，所有功能不依赖登录；左下角用户图标保留，显示“本地”并提示登录将在后续版本开放。后续仍按“控制台验证码 + 开发码”起步，再替换真实短信服务商。
2. **会话面板用 URL 表达**：应用内打开会话统一走 `/?run=<runId>`，保留筛选条件；旧 `/runs/[id]` 作为 Web 兼容入口重定向到该地址，不作为桌面端要求。
3. **配置只维护一份仓库登记表**：`febot.config.json` 顶层用 `repositories[]`，每条记录同时挂仓库名、开发/合并分支、Jenkins Job、项目名（可多个）。`repos`、`projectMap`、`branches.byRepo`、`jenkins.jobs` 全部由它派生，不再分别手填；`devplatform.appNames` / `codeNameMap` 属 `om/`，不纳入本登记表。
4. **自定义同步脚本 = 本地可信插件**：仅支持 Node；上传后由服务端以独立子进程执行，有超时、输出大小、工作目录限制，首次运行需确认。
5. **配置写入仍落到 `febot.config.json`**：不引入数据库；新增原子写入、缓存失效、密钥脱敏。首期无登录，设置写接口只允许本机同源请求。
6. **代码提交与“标记完成”拆开**：代码提交（commit / push / cherry-pick）移到独立审阅页，作为「接受全部改动」左侧的「代码提交」按钮；提交成功后自动标记“已接受”。“上传部署”改名为“标记完成”，✓ 只负责本地完成 + 同步远程状态，不再操作仓库代码。
7. **同步改为“本地全量”**：远程数据只用于新增/字段合并，**不删除本地任务**；本地生成字段不会被覆盖，本地已完成状态不会被远程滞后状态降级。
8. **任务字段只保留工作流需要的**：删除 `leval`、`taskType`、`developmentHour`、`factFinish` 四个常量/空字段，以及不再使用的 `maxHour`、`planStart`、`planEnd`、`factStart`、`version`；客户、需求等级、创建人、处理人、附件等展示字段保留为可选，缺失时不展示。

---

## 1. 现状盘点

### 1.1 技术栈与入口

- Next.js `16.3.7` App Router + React 19 + Tailwind v4 + shadcn/radix + xterm。
- 服务端数据是本地 JSON：`xiaoqian-manager/data/tasks.json`。
- 配置唯一来源：仓库根 `febot.config.json`（gitignore，`yarn setup` 从 `example/` 生成）。
- 流水线 runner 是独立进程，工作台通过 HTTP/WS 与其通信。
- 桌面端 Electron 加载同一套 Next 页面（`desktop/src/main/index.ts`）；**本期不改造桌面端，也不把桌面端纳入验收**。
- 注意：`xiaoqian-manager/AGENTS.md` 明确要求改代码前先读 `node_modules/next/dist/docs/`，本版本 Next 有破坏性变更。

### 1.2 当前界面结构

```
AppHeader（顶部导航：任务 / 待审 / 同步 / 主题）
└─ main max-w-6xl
   └─ TaskBoard
      ├─ 筛选：搜索框 / 模块下拉 / 状态下拉
      └─ 任务手风琴列表
         └─ TaskRow ──> StageSheet（右侧抽屉）
         └─ TaskRow ──> router.push(/runs/[id])（整页会话）
```

### 1.3 当前耦合点

| # | 位置 | 问题 |
|---|---|---|
| 1 | `app/api/tasks/[id]/stage/route.ts` | 阶段副作用写死：`deploy` 走 git/协作平台，`planer` 改描述，`skipGit` 直接完成；加一个步骤要改 API、schema、UI |
| 2 | `lib/domain/schema.ts` | `STAGE_KEYS` 是固定枚举，阶段顺序/数量不可配置 |
| 3 | `app/api/tasks/sync/route.ts` | 直接 import 协作平台 client/mapper，任务来源与业务同步强绑定 |
| 4 | `lib/server/config/root.ts` + `lib/server/git/config.ts` + `next.config.ts` | 同一份配置三处读取、各自缓存，没有写入入口 |
| 5 | 前后端读取的 `branches.byRepo` | 同时被当作“开发基准分支”和“部署目标分支”，语义混用 |
| 6 | `components/task/TaskBoard.tsx` | 同时持有筛选、弹框、run 轮询、动作调用，右栏/左栏无法复用 |
| 7 | 通知 | 浏览器 Notification 与站内消息未统一，缺少左栏消息列表 |
| 8 | 会话页 | 终端与 diff 文件强绑定在一个组件里，无法只取终端放进右栏 |

---

## 2. 目标与原则

### 2.1 目标

1. 工作台从“单列页面”升级为“三栏常驻工作台”。
2. 常用配置从手改 JSON 变成可视化弹窗，且写入后无需重启（`nextDevOrigins` 除外）。
3. 任务来源可插拔：内置协作平台 + 用户自定义 Node 脚本。
4. 阶段步骤可扩展：新增步骤不需要改核心 API。
5. 代码提交与“标记完成”拆分，两者可独立发生；提交成功后自动接受。
6. 同步改为本地全量：远程只做增量合并，不删除本地任务、不覆盖本地生成字段。
7. 配置文件一次性切换到新 schema，不保留旧字段运行时兼容。
8. 配置只维护一份仓库登记表，项目名/Jenkins/看板名不再分散在多张映射里。
9. 任务数据删除常量/空字段，展示字段改为可选。

### 2.2 非目标（本期不做）

- 不做登录/注册、短信验证码、会话 Cookie 与权限控制（列入后续阶段）。
- 不做桌面端改造；`desktop/` 保持现状，不纳入验收。
- 不做云端多租户、权限矩阵、团队协作。
- 不重写 runner / PTY / pipeline 剧本。
- 不引入数据库或 ORM。
- 不做移动端专门布局（桌面优先，窄屏降级）。
- 不做自定义脚本的定时调度/市场分发（P2 之后再议）。
- 不支持 Node 之外的脚本运行时。

### 2.3 架构原则

- **按领域分目录**：`domain` 放前后端共享类型与纯函数，`server` 放文件/进程/网络实现。
- **适配器优先**：任务来源、阶段副作用、通知来源都通过接口注册，业务路由只做编排。
- **单一配置入口**：所有配置读写走 `lib/server/config/store.ts`。
- **UI 与业务动作分离**：列表、左栏、右栏只是展示；读写在 hooks / API 层。
- **不保留旧配置兼容**：新 schema 直接替换，所有读取方在同一版本内改完；任务数据仍按可选字段宽松解析。

---

## 3. 目标信息架构

### 3.1 三栏布局

```
┌──────────────────┬──────────────────────────────────┬────────────────────────┐
│ 左 15%           │ 中 flex（约 55%）                │ 右 30%                 │
│                  │                                  │                        │
│ [图标] 小前   [«]│ [搜索][模块][状态]   [+][同步]   │ 任务标题 · 状态 · 连接 │
│                  │                                  │ ────────────────────── │
│ 消息 / 通知      │ 任务列表（手风琴）               │ 终端（xterm）          │
│ · 待你确认 2     │  任务 A  ▸                       │                        │
│ · 流水线完成     │  任务 B  ▾                       │                        │
│ · 同步失败       │    [阶段流程图]                  │                        │
│                  │    [描述/轨迹/附件]              │                        │
│                  │                                  │ ────────────────────── │
│                  │                                  │ 接受 重做 终止 审阅↗   │
│                  │                                  │                        │
│ [用户] [设置]    │                                  │                        │
└──────────────────┴──────────────────────────────────┴────────────────────────┘
```

- 左栏宽度：`15%`，`min-width: 220px`，折叠后 `56px`。
- 右栏宽度：`30%`，`min-width: 420px`。
- 中间自适应；三栏高度均为 `100dvh`，各自内部滚动。
- 断点：
  - `>= 1280px`：完整三栏。
  - `1024–1279px`：左栏固定 220px，右栏默认隐藏，可通过中间栏右上角按钮唤出。
  - `< 1024px`：左栏只留图标轨道；右栏改为全屏浮层。
- 左栏折叠状态存 `localStorage`。
- 右栏是否显示与当前选中 run 绑定。

### 3.2 路由策略

| URL | 渲染 |
|---|---|
| `/` | 三栏工作台；`?run=<runId>` 控制右栏会话 |
| `/runs/[id]` | 兼容入口，`redirect()` 到 `/?run=<id>` |
| `/review` | 独立全宽待审队列页 |
| `/runs/[id]/review` | 独立全宽审阅页 |

- 应用内“打开会话”只改 query，不整页跳转，保留中间栏筛选和展开状态。
- 审阅链接统一 `target="_blank"`，新页签打开。
- 浏览器通知继续使用 `/runs/<id>`，由重定向兜底。
- **路由采用“页面内组合”而不是 route group**：`app/page.tsx` 自己渲染 `WorkbenchShell`，`app/layout.tsx` 不承担工作台布局；审阅页不套壳。实施前仍按 `AGENTS.md` 先查 `node_modules/next/dist/docs/` 确认 App Router 用法。

### 3.3 客户端状态划分

新增 `components/workbench/WorkbenchProvider.tsx`，提升到三栏共同父级：

```ts
interface WorkbenchContextValue {
  tasks: Task[];
  runs: PipelineRun[];
  byTask: Record<string, PipelineRun>;
  online: boolean;
  selectedRunId: string | null;
  openRun: (runId: string) => void;
  closeRun: () => void;
  refreshTasks: () => void;
  refreshRuns: () => void;
}
```

- 全页只保留一份 `useRuns()` 轮询，左栏通知和右栏共用，避免重复请求。
- `TaskBoard` 只保留筛选与列表渲染，动作通过 `useTaskActions()`。
- 右栏 `RunPanel` 自己管理 WS 与终端，复用抽出的 `useRunSession(runId)`；**右栏不显示时间线**。

---

## 4. 详细设计

### 4.1 应用外壳

新增/调整：

- `components/workbench/WorkbenchShell.tsx`：三栏骨架 + Provider。
- `components/workbench/Sidebar.tsx`：左栏。
- `components/workbench/RunPanel.tsx`：右栏。
- `app/page.tsx`：改为读取 `searchParams.run`，渲染 `WorkbenchShell`。
- `app/runs/[id]/page.tsx`：改为 `redirect('/?run=' + id)`。
- `app/layout.tsx`：只保留主题/Toast 等全局 Provider；工作台壳由页面自己组合，审阅页不加载右栏。

验收点：

- 三栏各自滚动，互不挤压。
- 刷新页面后 `?run=` 仍能恢复右栏。
- 关闭右栏不丢失中间栏筛选。

### 4.2 左侧栏

从上到下三块：

#### 第一块：品牌与折叠

- 左：项目图标 + 名称“小前工作台”。
- 右：`PanelLeftClose / PanelLeftOpen` 图标，点击折叠/展开。
- 折叠后只显示图标，悬停显示 tooltip。
- 折叠状态写入 `localStorage`。

#### 第二块：消息 / 通知

通知由客户端派生，不新增后端存储：

```ts
type NotificationItem = {
  id: string;                       // 稳定去重键
  kind: "needs_input" | "failed" | "done" | "review" | "runner_offline" | "sync_error";
  title: string;
  body?: string;
  taskId?: string;
  runId?: string;
  createdAt: string;
  readAt?: string;
};
```

来源与排序：

| 类型 | 来源 | 点击行为 |
|---|---|---|
| 待你确认 | `run.status === "needs_input"` | 右栏打开该 run |
| 流水线失败 | `run.status === "failed"` | 右栏打开该 run |
| 流水线完成 | `run.status === "done"` 且最近 24h | 右栏打开该 run |
| 待审 | `run.status === "done"` 且有改动且未接受 | 新页签打开 `/runs/[id]/review` |
| runner 离线 | `online === false` | 提示启动命令 |
| 同步失败 | 最近一次同步结果存入 localStorage | 打开同步弹窗 |

- 已读状态：`localStorage["febot.notified.<userId|guest>"]`，存 `id -> readAt`。
- 顶部显示未读数；提供“全部已读”。
- 列表按“今天 / 更早”分组；空态显示“暂无消息”。
- 相关通知去重键沿用 `runId:status`，与现有 `useRuns` 通知去重逻辑合并，避免双份。
- 浏览器系统通知保留，点击后跳 `/?run=`；桌面端通知不在本期范围。

#### 第三块：用户与设置（固定在底部）

- 用户图标（首期占位）：
  - 显示默认头像与“本地”文案。
  - 点击打开轻量 `Dialog`：说明“当前为本机单用户模式，登录/注册将在后续版本开放”，不提供手机号表单与接口。
  - 后续接入登录后，再替换为昵称首字母与用户菜单；组件边界保留为 `UserMenu`。
- 设置图标：打开居中「工作区设置」弹窗，无需登录。
- 两个弹窗均为 `Dialog`，不使用抽屉。

### 4.3 中间栏

#### 4.3.1 筛选条

保持现有三个筛选，布局改为左对齐：

1. 搜索框：标题 / 任务 ID / 模块（占位文案不变）。
2. 模块下拉：选项来自任务数据 `module`；接入设置后也可来自 `repositories[].projects[].name`。
3. 状态下拉：
   - `未开始`
   - `计划`
   - `写代码`
   - **`已完成`**（原“上传部署”改名；值仍是 `deploy`，`currentStageKey` 逻辑不变）

右侧两个图标按钮：

- `+`：打开「新增任务」居中弹窗。
- `同步`（`RefreshCw`）：打开「同步任务」居中弹窗/页面。

保留“共 N 个任务”“N 个会话待你处理”“runner 未启动”提示。

#### 4.3.2 任务列表

- 复用现有 `TaskRow` / 手风琴 / 阶段流程图 / Tabs。
- “打开会话”从 `router.push('/runs/[id]')` 改为 `openRun(run.id)`（即 `?run=`）。
- 当前右栏选中的任务行加高亮边框。
- 右侧进度、状态徽章保留。

#### 4.3.3 阶段弹窗与「标记完成」

- `StageSheet` → `StageDialog`，使用 `Dialog`，`max-w-lg`，垂直居中。
- 通用字段：状态、负责人、备注、计划节点修改描述、当前标记 / 开始时间 / 完成时间。
- “上传部署”步骤改名为“标记完成”；内部 key 仍保留 `deploy`，避免旧任务数据迁移。
- **不再在弹窗里选择代码仓库 / 目标分支**：代码提交已移到审阅页，仓库来自 run 的 `repoRoot`，目标分支来自设置里的合并分支。
- 阶段卡片右下角保留 ✓ 图标（复用 `StageNode` 现有的 `canDirectComplete`）：
  - 点击 = 标记完成。
  - 流程：先执行远程完成（协作平台回写 / 自定义完成脚本），成功后再把本地 `deploy` 阶段置 `done`、`twStatus` 置“已完成”、写入 `finishedAt`；远程失败则不落本地状态。
  - 有远程来源时先弹确认：“将标记完成并同步远程任务，确定？”
  - 如果该任务有 run、存在未提交改动且 `codeSubmission` 为空，确认框额外提示：“代码尚未提交，仍要标记完成？”
  - 无远程来源（手动任务）时，直接本地完成。
  - 自定义来源未配置完成脚本时，提示“该来源未配置完成同步脚本”，二次确认后才允许仅本地完成；来源配置可改为强制模式。
- 原“直接完成（`skipGit`）”入口被这个 ✓ 取代；`skipGit` 参数保留为兼容别名，内部不再执行 git。
- P1 阶段仍走 `PATCH /api/tasks/[id]/stage`；P3 迁到通用阶段接口与 `remote-complete` 处理器。

### 4.4 右侧会话面板

#### 4.4.1 组件拆分

当前 `SessionView` 同时包含 WS、时间线、终端、DiffPanel、操作条。拆为：

- `components/pipeline/useRunSession.ts`：WS 连接/重连/补发/输入/resize/状态机，返回 `{ run, events, connected, online, sendInput, sendResize, termApiRef }`。
- `components/pipeline/TerminalPane.tsx`：保持不动。
- `components/pipeline/RunPanel.tsx`：右栏版本。
- `components/pipeline/SessionView.tsx`：整页版本（仅保留代码/排查用，本期不再作为入口），复用同一 hook。

#### 4.4.2 右栏内容

按用户要求，**去掉改动文件区（DiffPanel）**，只保留会话窗口：

```
┌ 任务标题 · 模块 · 状态徽章 · WS 状态 · [关闭]
│
│ 终端（占满剩余高度）
│
└ 接受 | 要求重做 | 终止 | 审阅↗
```

- 没有选中 run：显示空态“从任务或消息中打开一个会话”。
- runner 离线：显示提示与启动命令。
- `审阅` 按钮：`<a href={`/runs/${runId}/review`} target="_blank" rel="noopener noreferrer">`。
- **右栏不显示时间线**，也不提供折叠入口；本期不新增“开发者时间线”视图，如后续需要再单独设计。
- 由于没有文件列表：
  - 右栏保留“接受 / 要求重做 / 终止”。
  - **“驳回”只在独立审阅页**（需要勾选文件）；右栏不提供驳回。
  - **代码提交也不在右栏**：统一在审阅页操作，避免把“看会话”误当成“提交代码”。
- 终端尺寸变化依赖容器，`ResizeObserver` 由 `TerminalPane` 现有逻辑处理；右栏展开/收起时要触发一次 resize。

#### 4.4.3 打开会话的入口

- 任务行“打开会话” → `openRun(run.id)`。
- 左栏通知点击 → `openRun(runId)`。
- 浏览器通知点击 → `/?run=<id>`。
- 待审通知 → 新页签 `/runs/[id]/review`。

### 4.5 审阅路由与「代码提交」

- `/review` 与 `/runs/[id]/review` 保持独立路由。
- 不套三栏壳，保持全宽。
- 所有入口使用新页签：
  - 右栏“审阅”按钮。
  - 左栏待审通知。
  - `ReviewQueue` 中的会话链接。
- 顶部 `AppHeader` 可精简为“返回工作台 / 主题 / 同步”，不再承载主工作台导航。

**新增「代码提交」按钮**（原“上传部署”里的仓库操作）：

- 位置：审阅页底部操作条，`接受全部改动` 左侧。
- 顺序：`[代码提交] [接受全部改动] [驳回选中]`。
- 作用：当前工作区改动 → commit → push 源分支 → cherry-pick 到合并目标分支；若合并分支与开发分支相同，则只 commit + push 源分支，跳过 cherry-pick（复用现有 `deploy` 的 `source !== target` 守卫）。
- 前置条件：
  - run 已到终态（`done` / `failed` / `cancelled` 中允许提交的状态），live run 禁用并提示。
  - 当前 diff 非空。
  - 已配置该仓库的合并分支。
- 工作目录直接使用 `run.repoRoot`；仓库名（`path.basename(run.repoRoot)`）仅用于查分支配置。
- 目标分支解析：该仓库的 `mergeBranch` > `defaults.mergeBranch`；两者都没有时禁用提交并提示“请先在设置中配置合并分支”。**不回退旧规则。**
- 默认提交**全部工作区改动**；审阅页的文件勾选只用于驳回，不影响提交范围。
- 提交成功：
  - 显示“已提交 `<sha>` → `<branch>`”；
  - 写入任务的 `codeSubmission`；
  - **自动标记该 run 为已接受**（写入 `acceptedAt`，UI 显示“已接受”），无需再点「接受全部改动」。
- 提交后如又有新改动，允许再次提交；每次只 cherry-pick 新产生的提交。`codeSubmission` 仅保留最近一次，再次提交覆盖旧值。
- 「接受全部改动」保留为“只标记接受、不提交代码”的独立动作；代码提交则自动完成接受。
- API：`POST /api/runs/[id]/submit-code`，成功后返回更新后的 run（含 `acceptedAt`）与 `codeSubmission`。
- 审阅页服务端需要额外读取任务，把 `task.codeSubmission` 传给 `ReviewView`。

---

## 5. 登录与注册（后续阶段，本期不实施）

> 评审结论：登录不强制，且首期不做。本节仅保留后续设计，当前版本不创建 `data/auth/`、不新增 `/api/auth/*`、不引入 Cookie 鉴权。左下角用户图标只做本地占位说明。

### 5.1 交互（后续）

左下角用户图标 → 居中 `Dialog`：

- Tabs：`登录` / `注册`。
- 手机号输入（`^1[3-9]\d{9}$`）。
- 验证码输入 + “获取验证码”（60s 倒计时）。
- 注册页额外：昵称（可选，默认“用户”+手机尾号 4 位）。
- 协议勾选（占位）。
- 登录成功：关闭弹窗，左下角显示昵称首字母，Toast “已登录”。

### 5.2 数据与 API（后续）

存储目录：`xiaoqian-manager/data/auth/`（已随 `data/` 被 standalone 排除）。

`users.json`：

```json
{
  "version": 1,
  "users": [
    {
      "id": "u_01J...",
      "phone": "13800000000",
      "nickname": "示例负责人",
      "createdAt": "2026-11-04T08:00:00.000Z",
      "lastLoginAt": "2026-11-04T08:00:00.000Z"
    }
  ]
}
```

`sessions.json`（也可改为无状态签名 Cookie，二选一）：

```json
{
  "version": 1,
  "sessions": [
    { "tokenHash": "...", "userId": "u_...", "expiresAt": "2026-11-11T08:00:00.000Z" }
  ]
}
```

接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/send-code` | `{phone, purpose}`；60s 限流；开发模式返回 `devCode` |
| POST | `/api/auth/login` | `{phone, code}`；用户不存在返回 `need_register` |
| POST | `/api/auth/register` | `{phone, code, nickname}`；创建用户并登录 |
| POST | `/api/auth/logout` | 清 Cookie |
| GET | `/api/auth/me` | 返回当前用户或 `null` |

- Cookie：`febot_session`，`HttpOnly`、`SameSite=Lax`、7 天、生产环境 `Secure`。
- 验证码：6 位数字，5 分钟有效，最多尝试 5 次；内存存储，服务重启失效可接受。
- 发送方抽象：

```ts
interface SmsProvider {
  send(phone: string, code: string): Promise<void>;
}
```

默认 `ConsoleSmsProvider`：服务端日志打印；仅当 `FEBOT_AUTH_DEV=1` 时把 `devCode` 放进响应，方便本地联调。接真实短信服务商时只替换 provider。

### 5.3 登录与工作区的关系（后续）

- 首期工作区固定为本机单用户模式：
  - 新增任务 `createdName` 使用 `本机用户`；
  - 同步执行人继续取 `teamwork.username`；
  - 通知已读状态使用 `guest` 命名空间。
- 后续登录上线后，再切换为：新增任务默认取用户昵称、同步执行人可覆盖、通知已读按用户区分。
- 仍不计划强制登录；如需限制，后续再加 `features.requireAuth`。

---

## 6. 可视化设置

### 6.1 入口与形态

左下角设置图标 → 居中 `Dialog`（宽 `max-w-4xl`，高 `85vh`），内部 Tabs：

1. `仓库与分支`
2. `任务来源`
3. `开发环境`
4. `关于 / 诊断`（可选）

保存按钮固定在底部。

**首次启动初始化**：

- 检测 `febot.config.json` 不存在，或缺少新 schema 的关键字段（`repoRoot`、`repositories[]`、`defaults`）时，自动打开设置弹窗并进入“初始化模式”。
- 必填：仓库根目录、至少一个仓库、该仓库的开发分支与合并分支、至少一个项目名。
- 可选：`jenkinsBase`、`nextDevOrigins`、`features.hindsight`；协作平台凭据仍可从 `yarn setup` 生成的配置中带入。
- 保存成功后关闭弹窗并刷新工作台；初始化期间不要求登录。
- 用户也可以从设置图标重新进入并修改，保存后配置缓存立即失效。

### 6.2 仓库与分支（统一仓库登记表）

#### 目标

一条仓库记录同时维护：仓库名、开发/合并分支、Jenkins Job、项目（可多个）。`repos`、`projectMap`、`branches`、`jenkins.jobs` 全部由这张表派生，不再分别手填；`devplatform.appNames` / `codeNameMap` 属 `om/`，不进这张表。

#### 交互

1. 输入或粘贴“仓库根目录”，例如 `D:\febot\gitlab`。
2. 点击「获取仓库」。
3. 服务端扫描该目录直接子文件夹：
   - 只保留含 `.git` 的目录（`.git` 为目录或文件，兼容 worktree）。
   - 读取当前分支 `git -C <repo> branch --show-current`（只读，失败则留空）。
   - 返回 `{ name, path, currentBranch, isGit }`。
4. 前端渲染仓库卡片/表格：

| 仓库 | 开发分支 | 合并分支 | Jenkins Job | 项目 |
|---|---|---|---|---|
| demo-product-a-ui | `dev-feature`（预填当前分支） | `dev` | `demo_web` | `示例产品 A` |
| demo-product-b-ui | `dev-feature` | `dev` | `/demo-product-b-job` | `示例产品 B`、`示例产品 C`、`示例产品 D` |
| demo-product-f-ui | `dev`（覆盖默认） | `dev` | `/demo-product-f-job` | `示例产品 F` |

- 仓库名只读，来自扫描结果。
- 开发/合并分支：默认取顶部全局默认值，可逐仓覆盖。
- Jenkins Job：只填 job 路径，地址由全局 `jenkinsBase` 统一拼接；不填表示该仓库没有 Jenkins。
- 项目：标签输入，一个仓库可加多个项目；每个项目可展开配置：
  - `标题关键词 keywords`：同名项目映射多个仓库时用于消歧，例如 `PDA`、`示例产品 B 大屏`。
- 校验：
  - 开发分支、合并分支不能为空。
  - 开发分支与合并分支允许相同（trunk 开发仓库）；相同时「代码提交」只 commit + push，不 cherry-pick。
  - 同一项目名映射到多个仓库时，要求至少一个条目配置 `keywords`，或明确确认使用默认条目。

#### 生成配置

以下只展示仓库相关片段；保存时保留 `teamwork`、`features`、`nextDevOrigins` 等主项目段，`devplatform`、`codeNameMap`、`jenkins`（`base`/`jobs`）属 `om/` 原样保留、主应用不读取不改写。

```json
{
  "repoRoot": "D:/febot/gitlab",
  "jenkinsBase": "http://192.168.1.120:9990/jenkins/job",
  "defaults": {
    "devBranch": "dev-feature",
    "mergeBranch": "dev"
  },
  "repositories": [
    {
      "name": "demo-product-a-ui",
      "jenkinsJob": "demo_web",
      "projects": [{ "name": "示例产品 A" }]
    },
    {
      "name": "demo-product-f-ui",
      "devBranch": "dev",
      "jenkinsJob": "/demo-product-f-job",
      "projects": [{ "name": "示例产品 F" }]
    },
    {
      "name": "demo-product-b-ui",
      "jenkinsJob": "/demo-product-b-job",
      "projects": [
        { "name": "示例产品 B" },
        { "name": "示例产品 C" },
        { "name": "示例产品 D" }
      ]
    },
    {
      "name": "demo-product-b-web",
      "jenkinsJob": "/demo-product-b-web",
      "projects": [{ "name": "示例产品 B", "keywords": ["示例产品 B 大屏"] }]
    }
  ]
}
```

#### 派生规则

| 派生视图 / 消费方 | 新来源 |
|---|---|
| `repos` | `repositories[].name` |
| `projectMap` | `repositories[].projects[]` → `{ product: name, repo, keywords }` |
| `devDefault`（原 `branches.default`） | `defaults.devBranch` |
| `devByRepo`（原 `branches.byRepo`） | 各仓库的 `devBranch` 覆盖值 |
| `mergeDefault`（新增，无旧字段） | `defaults.mergeBranch` |
| `mergeByRepo`（新增，无旧字段） | 各仓库的 `mergeBranch` 覆盖值 |
| `branches.candidates` | 以上开发/合并分支值的并集，不落盘 |
| `jenkins.jobs` | `repositories[].name → jenkinsJob` |
| `jenkins.base` | `jenkinsBase` |

- 不保留旧的多表配置；旧 `repos` / `projectMap` / `branches` / `jenkins.jobs` 不再由主应用读取。
- `devplatform.appNames` / `codeNameMap` 属 `om/` 系统，不在本登记表派生、不在本计划迁移；`om/` 继续按其现有方式读取自己维护的映射（后续 om 独立拆分时自行处理）。
- 同一项目名跨仓库（如示例产品 B 的大屏与管理端）通过 `keywords` 明确区分。

### 6.3 任务来源

- 列出内置来源：`协作平台`（只读，显示是否已配置账号）。
- 列出自定义来源：名称、拉取入口、完成入口、上传时间、最近运行结果。
- 操作：上传新版本、单独更新完成脚本、试运行拉取、删除。
- 每个来源展示状态：
  - 拉取脚本：已配置 / 缺失 / 最近失败。
  - 完成脚本：已配置 / 未配置 / 最近失败；`complete.mode` 为 `required` 时缺失会阻止标记完成。
- 协作平台的账号/密码继续在 `teamwork` 段维护；本期设置页只展示“已配置/未配置”，不把密钥回传到前端。

### 6.4 开发环境

- `nextDevOrigins`：标签输入，允许多个 IP/域名。
  - 注意：Next 在启动时读取该配置，保存后需重启 dev server 才生效。
  - 弹窗内明确提示“请重启 `yarn dev`”；本期不接桌面端自动重启。
- `features.hindsight`：开关。
  - 只写配置；流水线下次启动时读取。UI 提示“对下一次流水线生效”。

### 6.5 配置读写安全

新增 `lib/server/config/store.ts`：

```ts
export function readConfig(): RootConfig;                 // 原始只读
export function readSanitizedConfig(): SanitizedConfig;   // 脱敏，可返回前端
export function patchConfig(patch: ConfigPatch): RootConfig; // 原子写 + 失效缓存
export function resetConfigCache(): void;
```

规则：

- 写入：临时文件 + `rename` 原子替换；只覆盖 patch 中出现的字段。
- 首次保存 / 初始化落盘前，**显式剥离主项目已被替换的旧键** `repos`、`projectMap`、`branches`；`devplatform`、`codeNameMap`、`jenkins`（`base`/`jobs`）属 `om/`，原样保留、主应用不读取不改写。
- 读取：统一缓存，记录文件 `mtime`；外部改动也能被发现。
- 脱敏：`teamwork.password`、`teamwork.cookie`、`teamwork.autograph` 不回传；改为 `hasTeamworkCredentials: boolean`。
- 所有写接口校验 `Origin` 与 `Host` 同源，禁止跨站写。
- 首期无登录：设置写接口**只允许本机同源请求**（`Host` 为 `localhost` / `127.0.0.1` / `::1`）；首次完整初始化由设置弹窗直接完成。
- 如果用户显式把服务暴露到局域网，写接口返回“当前为本地模式，请在本机操作”，并提示后续登录能力。

---

## 7. 新增任务

### 7.1 入口

中间栏 `+` 图标 → 居中 `Dialog`（`max-w-2xl`），分四组：

#### 基本信息

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| 标题 `title` | 是 | - | 任务标题 |
| 模块 `module` | 是 | 从已配置项目名选择 | 定仓依据；可选“自定义” |
| 协作状态 `twStatus` | 否 | `待处理` | 下拉：待处理 / 处理中 / 已完成 |
| 执行人 `assignee` | 否 | 本机用户 | 首期无登录 |
| 客户 `customerName` | 否 | - | 展示字段 |
| 需求等级 `demandLevel` | 否 | - | 展示字段 |

#### 需求描述

| 字段 | 必填 | 说明 |
|---|---|---|
| 需求描述 `description` | 否 | 平台原文/初始描述 |
| 计划描述 `plannedDescription` | 否 | 启动流水线的必填输入，可稍后在计划节点补 |
| 分配说明 `assignDescription` | 否 | - |

#### 附件

| 字段 | 必填 | 说明 |
|---|---|---|
| `attachments` | 否 | URL 列表，一行一个 |

自动生成、不在表单中展示的字段：

- `id`：`local-<yyyyMMddHHmmss>-<4位随机>`，服务端生成并保证不冲突。
- `demandId`: `""`
- `handlers`: `[]`
- `createdName`: `本机用户`（后续登录后改为用户昵称）
- `createdTime`: 当前时间
- `stages`: 按当前阶段定义生成，全 `pending`
- `trajectory`: 追加一条“新建任务”
- `syncedAt`: 当前时间
- `source`: `manual`
- `externalId`: `""`
- `codeSubmission`: `null`（代码提交后写入）

### 7.2 API

- `POST /api/tasks`：zod 校验；写入 `tasks.json`；返回新任务。
- `GET /api/tasks` 保持现有行为。
- `PATCH /api/tasks/[id]`：预留，用于后续编辑基础字段（本期可不做）。
- 唯一性：同一 `title + module` 允许重复；以 `id` 为准。

### 7.3 同步覆盖规则

- 手动任务 `source = "manual"`。
- 同步采用本地全量：协作平台只按同来源身份新增/合并，**从不删除**本地任务；手动任务 id 前缀 `local-`，不会被误判为远程任务。
- 如果后续支持“把手动任务转成某个来源”，再单独设计。

### 7.4 任务字段精简

现状共 27 个字段。按“工作流必需 / 展示可选 / 删除”分三档：

#### 保留（工作流必需）

| 字段 | 用途 |
|---|---|
| `id` | 任务身份、run 关联 |
| `demandId` | 协作平台需求 ID；计划文件「查询ID」、同步明细 |
| `title` | 标题、定仓关键词匹配 |
| `module` | 项目名，定仓依据 |
| `assignee` | 执行人 |
| `twStatus` | 协作状态、列表筛选、完成状态 |
| `stages` | 阶段进度 |
| `trajectory` | 轨迹；同步时与远程条目合并 |
| `description` | 平台原文 |
| `plannedDescription` | 计划节点整理后的描述，启动流水线必需 |
| `assignDescription` | 分配任务说明，写入计划文件 |
| `syncedAt` | 最近同步时间 |
| `source` / `externalId` | 任务来源与远程身份（新增） |
| `codeSubmission` | 代码提交记录（新增） |

#### 保留为可选（缺失时不展示）

| 字段 | 当前用途 | 处理 |
|---|---|---|
| `customerName` | 列表/详情展示客户 | 可选 |
| `handlers` | 「处理人」Tab | 可选；远程未提供时为空数组；只保留开发人/状态 |
| `demandLevel` | 详情「难度」、计划文件元信息 | 可选 |
| `createdName` / `createdTime` | 详情「创建」、计划文件元信息 | 可选 |
| `attachments` | 「附件」Tab | 可选 |

#### 删除

| 字段 | 原因 |
|---|---|
| `leval` | 仅详情展示，11/11 都是常量“研发”，无业务分支 |
| `taskType` | 仅详情展示/计划文件元信息，11/11 都是常量“开发任务” |
| `developmentHour` | 0/11 有值，UI 只展示“已报工时”占位 |
| `factFinish` | 0/11 有值，UI 只展示“实际完成”占位 |
| `maxHour` | 详情/处理人表/计划文件中的工时展示，工作流不依赖；`handlers[].maxHour` 一并删除 |
| `planStart` / `planEnd` | 仅详情「计划时间」展示，排期不在本工作台维护 |
| `factStart` | 仅详情「实际开始」展示，工作流不依赖 |
| `version` | 仅详情/计划文件中的版本展示，已由协作平台与发布流程管理 |

#### 精简后的 schema

```ts
export const Task = z.object({
  id: z.string(),
  demandId: z.string().default(""),
  title: z.string(),
  module: z.string().default(""),
  assignee: z.string().default(""),
  twStatus: z.string().default(""),

  // 可选展示字段
  customerName: z.string().default(""),
  handlers: z.array(TaskHandler).default([]),
  demandLevel: z.string().default(""),
  createdName: z.string().default(""),
  createdTime: z.string().default(""),
  attachments: z.array(z.string()).default([]),

  // 工作流字段
  stages: z.array(Stage),
  trajectory: z.array(TrajectoryItem).default([]),
  description: z.string().default(""),
  plannedDescription: z.string().default(""),
  assignDescription: z.string().default(""),

  // 来源与提交
  source: z.string().default("teamwork"),
  externalId: z.string().default(""),
  codeSubmission: CodeSubmission.nullable().default(null),

  syncedAt: z.string(),
});
```

配套改动：

- `TaskHandler` 同步删除 `maxHour`，处理人表只保留开发人/状态。
- `mapper.ts` 不再映射 `leval/taskType/developmentHour/factFinish/maxHour/planStart/planEnd/factStart/version`。
- `runner.ts` 计划文件元信息移除「任务类型」「版本」「最大工时」三行。
- `TaskMeta.tsx` 移除「任务类型」「研发阶段」「最大工时」「已报工时」「版本」「计划时间」「实际开始」「实际完成」八项。
- `TaskTabs.tsx` 处理人表移除「最大工时」列。
- 旧 `tasks.json` 读取时不报错：缺失字段走默认值，已删字段被忽略；下次写入后自然消失。
- 如果后续确实需要这些展示字段，再从平台详情按需读取，不长期落库。

---

## 8. 自定义同步脚本

### 8.1 目标

把现在“从协作平台同步任务”的能力抽象成任务来源；用户上传一个文件夹，里面是自写脚本，用来返回任务列表。内置协作平台同步成为同一接口的一个实现。

### 8.2 目录结构

上传后的保存位置：

```
xiaoqian-manager/data/task-sources/
  <sourceId>/
    current/                # 当前启用版本
      febot.source.json
      fetch-tasks.mjs
      lib/...
    versions/
      20261104-153000/      # 历史版本，便于回滚
    last-run.json           # 最近一次运行结果摘要
```

`febot.source.json` 示例：

```json
{
  "name": "我的任务平台",
  "runtime": "node",
  "entry": "fetch-tasks.mjs",
  "timeoutMs": 60000,
  "maxOutputBytes": 2097152,
  "input": ["user", "statuses", "module"],
  "complete": {
    "entry": "complete-task.mjs",
    "timeoutMs": 60000,
    "mode": "optional",
    "input": ["taskId", "externalId", "title", "module", "plannedDescription"]
  }
}
```

- `complete.entry`：远程完成同步脚本；与拉取脚本放在同一个文件夹里。
- `complete.mode`：
  - `optional`：未配置时允许“仅本地完成”，但需二次确认（自定义来源默认）。
  - `required`：未配置或执行失败时禁止标记完成。
  - `none`：该来源没有远程完成概念，直接本地完成、不提示（仅手动来源内部使用）。
- 也允许单独上传/更新完成脚本，不必重传整个拉取文件夹。

### 8.3 输出契约

脚本从 stdin 读取参数，向 stdout 输出一行 JSON（或完整 JSON）：

```json
{
  "tasks": [
    {
      "externalId": "123456",
      "title": "单据日期置灰",
      "module": "示例产品 B",
      "assignee": "示例负责人",
      "customerName": "",
      "twStatus": "处理中",
      "demandLevel": "P2",
      "description": "……",
      "assignDescription": "……",
      "attachments": ["https://..."],
      "handlers": [],
      "trajectory": []
    }
  ]
}
```

- 只接受白名单字段；未知字段丢弃。
- `externalId` 必填，用作 `Task.id` 的来源键：最终 id = `src-<sourceId>-<externalId>`，避免与平台 id 冲突。
- 可选输出 `meta: { version, fetchedAt }`。
- 解析失败、非 0 退出、超时、输出超限都记为同步失败，保留旧任务不删除。

### 8.3.1 远程完成脚本契约

“标记完成”时，如果任务来自自定义来源，服务端调用 manifest 里的 `complete.entry`：

stdin：

```json
{
  "action": "complete",
  "taskId": "src-<sourceId>-<externalId>",
  "externalId": "123456",
  "title": "单据日期置灰",
  "module": "示例产品 B",
  "plannedDescription": "……",
  "completedAt": "2026-11-04T08:00:00.000Z"
}
```

stdout（可选）：

```json
{ "ok": true, "message": "已标记完成", "remoteStatus": "已完成" }
```

规则：

- 退出码 0 且 `ok !== false` = 成功；退出码非 0 或 `ok: false` = 失败。
- 脚本必须幂等：重复标记完成不应报错或重复产生副作用。
- 超时、输出超限、解析失败都视为失败，本地阶段保持不变。
- 执行环境与拉取脚本一致：独立子进程、清理敏感环境变量、`shell: false`。
- 内置协作平台来源不需要脚本，直接复用现有 `pushDevOperation(task.id, plannedDescription)`。

### 8.4 上传与执行

上传：

- 前端 `<input type="file" webkitdirectory multiple>` 选择文件夹。
- `POST /api/task-sources`（multipart）：
  - 保留相对路径。
  - 拒绝绝对路径、`..`、符号链接、空文件列表。
  - 单文件 ≤ 1MB，总大小 ≤ 20MB，文件数 ≤ 500。
  - 写入临时目录，校验 `febot.source.json` 与入口文件存在后，原子替换 `current/`。
- `GET /api/task-sources`：列表。
- `DELETE /api/task-sources/[id]`：删除来源（不删除已同步任务）。
- `POST /api/task-sources/[id]/preview`：试运行，返回解析后的任务预览，不写库。
- `POST /api/tasks/sync` body 增加 `{ source: "teamwork" | "<sourceId>", params }`。

执行：

```ts
const child = spawn(process.execPath, [entryPath], {
  cwd: currentDir,
  shell: false,
  windowsHide: true,
  timeout: manifest.timeoutMs,
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    FEBOT_SOURCE_ID: sourceId,
    FEBOT_INPUT: JSON.stringify(params),
  },
});
```

- 不传递 `teamwork` 等敏感环境变量。
- stdout/stderr 各截断到 2MB。
- 仅允许 `runtime: "node"`；Python 等后续再开。
- 拉取脚本与完成脚本共用同一套执行器，只是入口不同。
- 首次上传/首次运行弹窗明确提示：**脚本以当前用户权限在本机执行，请只上传你自己信任的代码。**

### 8.5 抽象接口

```ts
// lib/domain/task-source.ts
export interface TaskSourceContext {
  params: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface TaskSource {
  id: string;
  name: string;
  kind: "builtin" | "script";
  fetchTasks(ctx: TaskSourceContext): Promise<RawTask[]>;
  /** 标记完成时同步远程；manual 来源不实现 */
  complete?(task: Task): Promise<{ ok: boolean; message?: string }>;
  test?(): Promise<{ ok: boolean; message?: string }>;
}
```

```ts
// lib/server/task-sources/registry.ts
export function getTaskSource(id: string): TaskSource;
export function listTaskSources(): TaskSourceSummary[];
```

- `teamwork` 适配器：包装现有 `fetchList/fetchDetail/fetchRecord/fetchDemandTasks/rowToTask`，行为不变。
- `script` 适配器：读取 manifest，执行子进程，校验输出。
- `SyncService`：`fetchTasks -> normalize -> mergeTasks`，不再 import 具体平台。

### 8.6 同步弹窗 UI

`SyncDialog`（居中）：

1. 来源选择：`协作平台` + 已上传的自定义来源。
2. 参数区：执行人、状态、模块；自定义来源按 manifest `input` 显示。
3. 操作：
   - `试运行`：预览前 20 条，显示“新增 / 更新 / 本地独有（保留）”预估。
   - `开始同步`：执行并写库。
4. 内置来源显示“未配置账号”时的引导。
5. 自定义来源为空时，显示“上传文件夹”入口与格式说明。
6. 上传入口支持两种：
   - **整包上传**：文件夹内同时包含 `febot.source.json`、拉取脚本、完成脚本。
   - **仅更新完成脚本**：对已有来源单独上传 `complete-task.mjs`，不必重传拉取脚本。
7. 来源详情展示：拉取脚本状态、完成脚本状态（未配置 / 已配置 / 最近失败）、最近一次运行结果与错误摘要。
8. 未配置完成脚本时，在来源详情和“标记完成”确认框里都给出提示。

---

### 8.7 同步合并规则（本地全量）

同步语义从“远程全量、远程为准”改为“**本地全量、远程增量合并**”：

- 远程返回的任务：
  - 本地不存在 → 新增。
  - 本地已存在 → 逐字段合并，不覆盖本地生成字段。
- 远程没有返回、但本地存在的任务：**保留，不删除**。
- 删除任务只能由用户手动操作（后续可加“删除任务”按钮），同步不负责删除。
- 同步结果统计改为 `created / updated / unchanged / failed`；`removed` 固定为 `0`，保留字段以兼容旧前端。

#### 字段归属

| 字段 | 归属 | 合并规则 |
|---|---|---|
| `id` | 本地 | 身份键，永不覆盖 |
| `source` / `externalId` | 本地 | 来源标识，永不覆盖 |
| `stages` | 本地 | 阶段进度，永不覆盖 |
| `plannedDescription` | 本地 | 研发整理后的描述，永不覆盖 |
| `codeSubmission` | 本地 | 代码提交记录，永不覆盖 |
| `trajectory` | 混合 | 保留本地条目；远程新条目按 `time+operator+action+content` 去重后追加 |
| `syncedAt` | 服务端 | 每次同步刷新 |
| `title` | 远程 | 远程有值则更新 |
| `module` / `customerName` / `assignee` | 远程 | 远程有值则更新 |
| `twStatus` | 本地 | 工作台本地状态，同步**不覆盖**；新增任务时取来源脚本提供的初始状态，此后只看本地 ✅ 标记完成 |
| `demandLevel` | 远程 | 远程有值则更新 |
| `description` / `assignDescription` | 远程 | 平台原文，远程有值则更新 |
| `attachments` | 远程 | 远程提供数组时整体替换；未提供则保留本地 |
| `handlers` | 远程 | 远程提供数组时整体替换；未提供则保留本地 |
| `createdName` / `createdTime` / `demandId` | 远程 | 仅新增时使用；本地已有则不改 |

实现要点：

- 用 `undefined` 表示“远程未提供该字段”，不要用空串/空数组覆盖本地。
- `mergeTasks(incoming, { sourceId })` 不再接收 `scope` / `keepIds`；同步路由与调用方一次性改完，不做旧参数兼容。
- 同一来源内匹配身份：内置协作平台用平台 `id`，自定义脚本用 `externalId`；跨来源不合并。
- 自定义来源写入时把平台 id 同时存到 `externalId`，保证后续同步能稳定命中。
- 远程重复数据、字段格式非法：跳过该条并计入 `failed`，不影响其他任务。
- 同步过程仍走 `store.ts` 的串行写链，避免并发覆盖。

---

## 9. 阶段步骤解耦

### 9.1 要解决的问题

当前增加/调整一个步骤，需要同时改：

- `lib/domain/schema.ts` 的 `STAGE_KEYS`
- `app/api/tasks/[id]/stage/route.ts` 的 `if stageKey === ...`
- `components/task/StageSheet.tsx` 的 `isDeploy/isPlaner`
- `components/task/TaskRow.tsx`、`TaskFlow` 的展示
- `pipeline/runner.ts` 对 `coder` 的写死

### 9.2 阶段定义

```ts
// lib/domain/pipeline.ts
export interface StageFieldDefinition {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "repo" | "branch";
  required?: boolean;
  visibleWhen?: "always" | "complete";
}

export interface StageDefinition {
  key: string;
  name: string;
  order: number;
  handlers: string[];              // 完成时执行的处理器
  fields?: StageFieldDefinition[];
  ui?: { tone?: string };
}

export interface PipelineDefinition {
  stages: StageDefinition[];
}
```

默认定义保持不变：

```ts
export const DEFAULT_PIPELINE: PipelineDefinition = {
  stages: [
    { key: "planer", name: "计划", order: 1, handlers: ["manual"] },
    { key: "coder", name: "写代码", order: 2, handlers: ["pipeline-run"] },
    { key: "deploy", name: "标记完成", order: 3, handlers: ["remote-complete"] },
  ],
};

// 代码提交不是阶段处理器，而是“run 动作”：
// POST /api/runs/[id]/submit-code -> git-deploy（commit/push/cherry-pick）。
// 这样“提交代码”和“标记完成”可以独立发生，互不绑定。
```

### 9.3 阶段处理器

```ts
// lib/server/stages/types.ts
export interface StageTransitionContext {
  task: Task;
  stage: Stage;
  nextStatus: StageStatus;
  payload: Record<string, unknown>;
  options: { skipGit?: boolean };
}

export interface StageHandler {
  id: string;
  beforeComplete?(ctx: StageTransitionContext): Promise<void>;
  afterComplete?(ctx: StageTransitionContext): Promise<void>;
}
```

处理器注册：

- `manual`：无副作用。
- `pipeline-run`：启动/校验流水线前置条件。
- `remote-complete`：按任务来源分发远程完成：
  - `teamwork` → 现有 `pushDevOperation(task.id, plannedDescription)`。
  - `script` → 执行该来源 manifest 的 `complete.entry`。
  - `manual` / 无来源 → 直接通过，仅本地完成。
- `code-submit`（run 动作，不是阶段处理器）：提交、推送、cherry-pick；目标分支取合并分支。由 `POST /api/runs/[id]/submit-code` 调用。
- `script-hook`（预留）：拉取脚本的同步前后钩子。

通用路由：

- 新增 `PATCH /api/tasks/[id]/stages/[stageKey]`。
- 旧 `PATCH /api/tasks/[id]/stage` 保留为薄适配层，内部转调新逻辑。
- 处理器按 `StageDefinition.handlers` 顺序执行；任一步失败则整次转换回滚（不写 tasks.json、不写平台）。
- “标记完成”只执行 `remote-complete`，不再调用 `code-submit`；两者完全解耦。

### 9.4 Schema 放宽与迁移

```ts
// 旧
export const STAGE_KEYS = ["planer", "coder", "deploy"] as const;
export const Stage = z.object({ key: z.enum(STAGE_KEYS), ... });
stages: z.array(Stage).length(STAGE_DEFS.length)

// 新
export const Stage = z.object({ key: z.string().min(1), ... });
stages: z.array(Stage)

// 代码提交记录（本地生成，同步不覆盖）
export const CodeSubmission = z.object({
  repo: z.string(),
  targetBranch: z.string(),
  commit: z.string(),
  at: z.string(),
  sourceRunId: z.string().default(""),
});
codeSubmission: CodeSubmission.nullable().default(null)
```

- 读取时 `normalizeStages` 按当前 `PipelineDefinition` 重排/补齐：
  - 已有 key 保留状态。
  - 已删除的步骤保留在 `legacyStages`（可选）或直接丢弃；本期建议保留但不在 UI 展示，避免丢数据。
  - 新增步骤补 `pending`。
- 写入时按定义顺序排序。
- 默认定义与旧数据完全兼容。

### 9.5 配置中的阶段编排（P3 可选）

设置页可增加“高级：阶段编排”折叠区：

- 本期只支持重命名、启用/禁用内置步骤。
- 不支持拖拽新增自定义步骤（避免脚本执行安全面扩大）。
- 后续如需完全自定义，再开放 `handlers` 白名单选择。

### 9.6 任务来源与阶段解耦的收益

- `SyncService` 不认识协作平台。
- 阶段 API 不认识具体业务。
- UI 按 `PipelineDefinition` 渲染，不再写死 `isDeploy/isPlaner`。
- 通知按事件派生，不再和某个页面绑定。

---

## 10. 接口与文件清单

### 10.1 新增 API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/settings` | 读取脱敏配置 |
| PUT | `/api/settings` | 保存脱敏允许编辑的配置 |
| POST | `/api/settings/repos/scan` | 扫描仓库根目录 |
| POST | `/api/tasks` | 新增任务 |
| POST | `/api/tasks/sync` | 按来源同步；本地全量合并，不删除本地任务 |
| POST | `/api/runs/[id]/submit-code` | 代码提交：commit / push / cherry-pick，成功后自动接受 |
| GET | `/api/task-sources` | 任务来源列表 |
| POST | `/api/task-sources` | 上传脚本文件夹（可含拉取 + 完成脚本） |
| DELETE | `/api/task-sources/[id]` | 删除来源 |
| POST | `/api/task-sources/[id]/preview` | 试运行拉取脚本 |
| POST | `/api/task-sources/[id]/complete-script` | 单独上传/更新完成同步脚本 |
| PATCH | `/api/tasks/[id]/stages/[stageKey]` | 通用阶段转换（P2） |

登录相关接口（`/api/auth/send-code|login|register|logout|me`）推迟到后续阶段，本期不创建。首期如需用户标识，只使用前端 `local`/`guest` 占位。

### 10.2 新增前端组件

标“后续阶段”的条目不进入本期实现；本期只保留 `UserMenu` 占位。

| 文件 | 说明 |
|---|---|
| `components/workbench/WorkbenchShell.tsx` | 三栏骨架 + Provider |
| `components/workbench/WorkbenchProvider.tsx` | 共享 tasks/runs/selectedRun |
| `components/workbench/Sidebar.tsx` | 左栏 |
| `components/workbench/NotificationList.tsx` | 通知列表 |
| `components/workbench/UserMenu.tsx` | 左下角用户占位（本期不做登录表单） |
| `components/workbench/RunPanel.tsx` | 右栏会话 |
| `components/auth/AuthDialog.tsx` | 登录/注册（后续阶段） |
| `components/settings/SettingsDialog.tsx` | 设置弹窗；首次启动进入初始化模式 |
| `components/settings/RepoTable.tsx` | 仓库表格 |
| `components/settings/SourceList.tsx` | 任务来源管理 |
| `components/task/NewTaskDialog.tsx` | 新增任务 |
| `components/task/StageDialog.tsx` | 阶段弹窗（替换 Sheet） |
| `components/sync/SyncDialog.tsx` | 同步弹窗（替换 SyncButton 的 Dialog） |
| `components/pipeline/useRunSession.ts` | 会话逻辑 hook |
| `components/pipeline/RunTerminal.tsx` | 纯终端展示 |

### 10.3 新增服务端模块

标“后续阶段”的模块本期不创建。

| 文件 | 说明 |
|---|---|
| `lib/domain/settings.ts` | 设置类型与默认值 |
| `lib/domain/pipeline.ts` | 阶段/流水线定义 |
| `lib/domain/task-source.ts` | 任务来源接口 |
| `lib/domain/notification.ts` | 通知类型 |
| `lib/server/config/store.ts` | 配置读写/缓存/脱敏 |
| `lib/server/config/repos-scan.ts` | 仓库扫描 |
| `lib/server/auth/users.ts` | 用户存储（后续阶段） |
| `lib/server/auth/sessions.ts` | 会话（后续阶段） |
| `lib/server/auth/sms.ts` | 短信 provider（后续阶段） |
| `lib/server/task-sources/registry.ts` | 来源注册表 |
| `lib/server/task-sources/teamwork.ts` | 内置来源适配器 |
| `lib/server/task-sources/script.ts` | 自定义脚本适配器 |
| `lib/server/task-sources/upload.ts` | 文件夹上传落盘 |
| `lib/server/tasks/sync-service.ts` | fetch -> merge 编排 |
| `lib/server/stages/registry.ts` | 阶段处理器注册表 |
| `lib/server/stages/handlers/*.ts` | 各阶段处理器 |

### 10.4 需要修改的现有文件

| 文件 | 改动 |
|---|---|
| `app/page.tsx` | 读取 `?run=`，渲染三栏 |
| `app/layout.tsx` | 精简全局 Provider |
| `app/runs/[id]/page.tsx` | 重定向到 `/?run=` |
| `app/review/page.tsx` | 保持独立，适配顶部 |
| `app/runs/[id]/review/page.tsx` | 保持独立，审阅链接新页签 |
| `components/pipeline/SessionView.tsx` | 抽出 hook，复用 RunPanel |
| `components/pipeline/ReviewView.tsx` | 增加「代码提交」按钮，位于「接受全部改动」左侧；提交成功后展示“已提交 + 已接受” |
| `components/pipeline/DiffPanel.tsx` | `extraActions` 可承载代码提交状态提示（可选） |
| `components/flow/StageNode.tsx` | 「标记完成」✓ 改为远程完成语义，不再提示“不操作仓库代码” |
| `components/task/TaskBoard.tsx` | 拆筛选/列表/动作 |
| `components/task/TaskRow.tsx` | 打开会话改为 `openRun` |
| `components/task/StageSheet.tsx` | 改成 `StageDialog`；移除仓库/目标分支字段 |
| `components/sync/SyncButton.tsx` | 改成 `SyncDialog` |
| `components/layout/AppHeader.tsx` | 工作台顶部精简；审阅页保留 |
| `lib/domain/schema.ts` | 新增 `source` / `externalId` / `codeSubmission`；删除 `leval` / `taskType` / `developmentHour` / `factFinish` / `maxHour` / `planStart` / `planEnd` / `factStart` / `version`；`TaskHandler` 删除 `maxHour`；其余展示字段改为可选；阶段数组放宽 |
| `lib/server/store.ts` | 增加 `createTask`；`mergeTasks` 改为本地全量合并 |
| `lib/server/teamwork/mapper.ts` | 停止映射已删除的 9 个 Task 字段与 `handlers[].maxHour` |
| `lib/server/pipeline/runner.ts` | `renderPlanFile` 移除「任务类型」「版本」「最大工时」三行 |
| `components/task/TaskMeta.tsx` | 移除「任务类型」「研发阶段」「最大工时」「已报工时」「版本」「计划时间」「实际开始」「实际完成」八项 |
| `components/task/TaskTabs.tsx` | 处理人表移除「最大工时」列 |
| `lib/server/config/root.ts` | 改为配置 store 的选择器 |
| `lib/server/git/config.ts` | 改为配置 store 的选择器；从 `repositories[]` 派生开发/合并分支；移除旧 `repos.json` 与数组 `branches` 兼容 |
| `lib/domain/git.ts` | `GitOptions.defaultBranch` → `devDefault`、`branchByRepo` → `devByRepo`，新增 `mergeDefault` / `mergeByRepo`；`resolveBranchForRepo()` 改名 `branchForRepo()`（返回开发分支），新增 `mergeBranchForRepo()`（返回合并分支） |
| `lib/server/git/deploy.ts` | 拆出 `submitCode()`；目标分支改用合并分支 |
| `app/api/tasks/[id]/stage/route.ts` | 去掉 git/teamwork 副作用，改调 `remote-complete` |
| `app/api/tasks/route.ts` | 增加 POST |
| `app/api/tasks/sync/route.ts` | 改为 SyncService；不再传 `scope` / `keepIds` |
| `app/runs/[id]/review/page.tsx` | 读取任务，传 `task.codeSubmission` 给 ReviewView |
| `next.config.ts` | 只读 `nextDevOrigins`；注释重启要求 |
| `scripts/lib/requirement.mjs` | 分支解析改读 `repositories[]`：仓库 `devBranch` > `defaults.devBranch`；移除 `projectMap[].branch` |
| `scripts/resolve-repo.mjs` | 分支解析改读新字段；输出继续用 `branch` 表示开发分支，`branchSource` 更新为新字段名 |
| `scripts/ensure-config.mjs` | 更新配置提示文案为新 schema（`repoRoot / defaults / repositories`） |
| `example/febot.config.json` | 换成新 schema：`repoRoot / jenkinsBase / defaults / repositories[]`；`teamwork` / `features` / `nextDevOrigins` 保留，`devplatform` / `codeNameMap` / `jenkins` 段保留供 `om/` 使用（本计划不处理） |
| `.gitignore` | `data/auth` 本期不创建；`data/task-sources` 已在 `data/` 下则无需改 |

---

## 11. 兼容与迁移

### 11.1 配置

- **不兼容旧配置**：直接使用新 schema，只维护 `repositories[]`；主应用不再读取 `repos` / `projectMap` / `branches` / `jenkins.jobs`（`devplatform.appNames` / `codeNameMap` 属 `om/`，一直由 om 独立读取，本计划不动）。
- 所有读取方统一走派生视图：`repos`、`projectMap`、`branches.*`、`jenkins.jobs` 都是内存计算结果，不落配置。
- `readGitOptions()` 改为返回 `devDefault/devByRepo/mergeDefault/mergeByRepo`，由 `repositories[]` 派生；新增 `mergeBranchForRepo()`。
- 移除旧 `data/repos.json` 回退与”`branches` 为数组”的旧形状；`GIT_REPOS_FILE` 测试夹具保留，但内容必须使用新 schema。
- 所有读取方一次性改完：App（`lib/server/git/config.ts`、`lib/domain/git.ts`）、脚本（`scripts/lib/requirement.mjs`、`scripts/resolve-repo.mjs`、`scripts/ensure-config.mjs`）；`om/server.js` 不在此范围。
- 旧配置不自动迁移；由设置页首次完整初始化，或按新 schema 手工重写。缺少 `defaults.mergeBranch` 且仓库无 `mergeBranch` 时，代码提交禁用并提示去设置。
- 配置缓存改为 `mtime` 感知；保存后立即失效。
- `nextDevOrigins` 例外：Next 启动时读取，保存后需重启。

### 11.2 任务数据

- `Task.source` 默认 `teamwork`，旧数据解析不受影响。
- `Task.codeSubmission` 默认 `null`；旧数据无需迁移。
- 删除 `leval` / `taskType` / `developmentHour` / `factFinish` / `maxHour` / `planStart` / `planEnd` / `factStart` / `version` 以及 `handlers[].maxHour`：zod 读取时直接忽略，下次写入后从 `tasks.json` 消失；不做显式迁移脚本。
- 可选展示字段缺失时走默认值，UI 自动隐藏对应行，不阻塞旧数据加载。
- `stages` 由固定 3 项改为按定义解析；旧数据 key 齐全时等价。
- `deploy` 作为内部 key 保留，仅显示名改为“标记完成”，旧数据无需迁移。
- `skipGit` 参数保留为兼容别名，语义退化为“仅完成远程/本地状态，不操作仓库”。
- 手动任务 id 前缀 `local-`，不会与平台数字 id 冲突。
- 自定义来源 id 前缀 `src-`，不会与平台/手动冲突。

### 11.3 同步语义

- 从“远程全量”切换为“本地全量”：不再删除本地任务。
- `/api/tasks/sync` 不再接受 `scope` / `keepIds`，调用方随本次改造一起更新。
- 返回体保留 `removed: 0`，避免前端类型大改；新文案改为“新增 / 更新 / 保留”。
- 首次切换后建议跑一次同步，核对 `updated` 数量是否符合预期。

### 11.4 路由

- `/runs/[id]` 重定向到 `/?run=`，浏览器书签与通知继续可用。
- 审阅页 URL 不变。
- 本期不要求桌面端适配；`desktop/` 的深链行为不在验收范围。

### 11.5 会话

- `useRunSession` 与原 `SessionView` 的 WS 协议、`lastSeq` 补发、尺寸处理保持一致。
- 右栏只保留终端与操作条（去掉 DiffPanel 与时间线），不改变 runner 协议。
- 驳回能力保留在审阅页。
- 代码提交不改变 runner 协议；提交结果记录在任务的 `codeSubmission`。

---

## 12. 安全与边界

| 风险 | 措施 |
|---|---|
| 设置接口泄露协作平台密码/Cookie | GET 脱敏；只返回 `has*` 布尔；写接口保留原值 |
| 跨站写配置 | 校验 `Origin`/`Host` 同源；首期写接口只允许本机（loopback）访问 |
| 自定义脚本任意执行 | 用户显式确认；仅本地；子进程 + 超时 + 输出上限 + 清理环境变量；不上传即不执行 |
| 完成脚本失败后本地状态不一致 | 先执行远程完成，成功后再写本地阶段；失败保持原状态并返回错误 |
| 文件夹上传路径穿越 | 拒绝绝对路径、`..`、软链接；校验落盘路径在目标目录内 |
| 仓库扫描任意路径 | 仅本地使用；`realpath` 校验；只读 `readdir`/`git branch` |
| 代码提交与 AI 写入并发 | live run 禁止提交；同一仓库串行（复用 `git/deploy.ts` 的 per-repo 链） |
| 代码提交误推到错误分支 | 目标分支只从设置解析；提交前在 UI 显示 `repo → branch` 并二次确认 |
| 配置并发写 | 单进程串行写 + 原子 rename；可选 `revision` 冲突检测 |
| runner 离线/会话泄漏 | 右栏复用现有 WS 清理逻辑；关闭面板即 detach/断开 |

---

## 13. 实施阶段与工作量

### P0：地基与三栏骨架（约 2 人日）

- 配置 store（读写/缓存/脱敏）+ `GET/PUT /api/settings` + 仓库扫描 API。
- 新配置 schema（`repoRoot / jenkinsBase / defaults / repositories[]`）与 App/`scripts/` 所有读取方切换；派生视图集中在一个 helper。
- 首次启动初始化：配置缺失时自动打开设置弹窗并完成必填项。
- `WorkbenchShell` 三栏骨架、左栏折叠、右栏占位。
- 页面路由调整与 `/runs/[id]` 重定向；页面内组合，不使用 route group。

交付：能启动、三栏可见、配置能读能写。

### P1：工作台交互与代码提交拆分（约 3 人日）

- 左栏通知列表、用户占位菜单。
- 中间栏筛选迁移、状态文案改“已完成”。
- `StageSheet` → `StageDialog`；移除仓库/目标分支字段。
- “上传部署”显示名改“标记完成”；`StageNode` ✓ 改为远程完成语义。
- 审阅页增加「代码提交」按钮 + `POST /api/runs/[id]/submit-code`。
- 代码提交目标分支切换到仓库 `mergeBranch` / `defaults.mergeBranch`；提交成功后自动接受。
- `SessionView` 抽 hook + `RunPanel`，`?run=` 联动；右栏不显示时间线。
- 审阅入口新页签。
- 新增任务弹窗 + `POST /api/tasks`。

交付：用户要求的主体 UI、代码提交与标记完成拆分全部可用；无登录依赖。

### P2：任务来源插件与本地全量同步（约 3–4 人日）

- `TaskSource` 接口、`teamwork` 适配器包装。
- 自定义脚本文件夹上传、manifest 校验、子进程执行、预览。
- 完成同步脚本上传、执行、失败回滚。
- `SyncDialog` 替换现有同步弹窗。
- `mergeTasks` 改为本地全量合并（不删除、字段保护）。
- 设置页“任务来源”Tab。

交付：内置同步行为改为合并；可上传拉取 + 完成脚本。

### P3：阶段解耦与配置增强（约 3 人日）

- `PipelineDefinition` / `StageHandler` 注册表。
- `remote-complete` 处理器（按来源分发）。
- 通用阶段 API + 旧 API 适配。
- schema 放宽与迁移。
- 设置页“阶段编排”可选折叠区。
- 通知事件化（如需服务端通知）。

交付：新增/调整阶段不再改核心 API；代码提交与标记完成彻底解耦。

### P4：验收与收尾（约 1–2 人日）

- 回归测试、构建、lint。
- 文档：`README` 设置说明、自定义脚本格式、新配置 schema。
- `scripts/` 配置读取回归（定仓、开工门禁）。
- 不做桌面端冒烟；`desktop/` 保持现状。

总计约 **13–15 人日**。可并行：P0 后，P1 与 P2 的前后端可拆开；P3 依赖 P0 的配置 store。

### P5（后续，不排期）：登录与注册

- 手机号验证码登录/注册、Cookie 会话、用户菜单。
- 首期方案：`ConsoleSmsProvider` + 开发码；后续替换真实短信服务商。
- 设置写接口从“仅本机”升级为“本机或已登录”。
- 本节不占用当前 13–15 人日。

---

## 14. 验收清单

### 14.1 回归（现有能力不能坏）

- [ ] 协作平台同步：新增/更新数量符合预期；不再删除本地任务。
- [ ] 任务列表筛选：搜索、模块、状态（`已完成`）正确。
- [ ] 阶段弹窗保存：计划描述、负责人、备注；不再出现仓库/分支字段。
- [ ] 代码提交：commit / push / cherry-pick 成功；目标分支为合并分支。
- [ ] 标记完成：✓ 执行远程完成后本地 `deploy` 阶段变 `done`。
- [ ] 启动流水线：定仓、忙碌 409、计划描述为空 422。
- [ ] 会话：终端输出、输入、resize、断线重连、lastSeq 补发。
- [ ] 接受 / 要求重做 / 终止。
- [ ] 审阅页独立打开，diff 正常；驳回只在该页可用。
- [ ] runner 离线提示。
- [ ] 定仓与开工门禁使用新配置字段，行为与改造前一致。

### 14.2 新增能力

- [ ] 三栏比例 15 / 55 / 30，左栏可折叠，右栏可关闭。
- [ ] 左栏通知：待确认、失败、完成、待审、离线；点击打开对应会话。
- [ ] 右栏只有标题/终端/操作条，**没有时间线，也没有折叠入口**。
- [ ] 首次启动配置缺失时自动进入初始化；保存后可正常打开工作台。
- [ ] 设置：扫描仓库；每仓可配多个项目名；开发/合并分支保存后脚本与主应用立即读到新配置。
- [ ] 配置只维护一套 `repositories[]`；`repos` / `projectMap` / `branches.*` / `jenkins.jobs` 均为派生结果，不再单独出现在 `febot.config.json`。
- [ ] 配置为全新 schema；主应用不再读取旧 `repos` / `projectMap` / `branches` / `jenkins.jobs`（`devplatform.appNames` / `codeNameMap` 属 `om/` 不受影响）。
- [ ] `nextDevOrigins` 保存后提示重启；重启后生效。
- [ ] hindsight 开关写入配置。
- [ ] 首期无需登录即可打开设置、新增任务、启动流水线。
- [ ] 新增任务：必填校验、id 生成、列表出现、可编辑计划描述、可启动流水线。
- [ ] 上传自定义脚本：校验、试运行预览、同步入库、失败不影响旧任务。
- [ ] 上传完成脚本：标记完成时调用；失败时本地状态不变。
- [ ] 未配置完成脚本时，二次确认后允许仅本地完成；配置为 `required` 时禁止。
- [ ] 同步合并：本地独有任务保留；`stages` / `plannedDescription` / `codeSubmission` / 本地轨迹不被覆盖。
- [ ] 同步合并：`twStatus` 为本地状态，同步不覆盖（无降级问题）。
- [ ] 任务数据不再写入 `leval` / `taskType` / `developmentHour` / `factFinish` / `maxHour` / `planStart` / `planEnd` / `factStart` / `version`，也不再写入 `handlers[].maxHour`；旧 `tasks.json` 可直接读取。
- [ ] 任务详情不再出现「任务类型」「研发阶段」「最大工时」「已报工时」「版本」「计划时间」「实际开始」「实际完成」；处理人表不再有「最大工时」列。
- [ ] 审阅页「代码提交」位于「接受全部改动」左侧；提交后显示 sha 与目标分支。
- [ ] 代码提交成功后自动标记“已接受”，无需再点接受。
- [ ] 「标记完成」卡片 ✓ 可点击；无远程来源时仅本地完成。
- [ ] 审阅从右栏/通知打开新页签。
- [ ] 桌面端不在本期验收范围。

### 14.3 工程门禁

- [ ] `yarn --cwd xiaoqian-manager lint`
- [ ] `yarn --cwd xiaoqian-manager build`
- [ ] 无新的 TypeScript 错误
- [ ] 敏感字段不出现在任何 API 响应
- [ ] 上传/扫描路径穿越用例被拒绝

---

## 15. 已确认决策

| # | 事项 | 结论 |
|---|---|---|
| 1 | 登录是否强制 | 不强制；首期不做登录，后续阶段再补 |
| 2 | 短信服务商 | 后续首期用控制台验证码 + 开发码，再替换真实服务商 |
| 3 | 一个仓库多个项目名 | 支持；`repositories[].projects[]` 允许同一仓库多条 `projects` |
| 4 | 旧配置 | 不兼容；全部切换到新 schema，所有读取方一次改完 |
| 5 | 右栏时间线 | 移除，不保留折叠入口 |
| 6 | 右栏“驳回” | 移到独立审阅页；右栏不提供 |
| 7 | 自定义脚本运行时 | 仅支持 Node |
| 8 | 设置写权限 | 首期无登录；本机首次完成完整初始化，写接口仅限 loopback |
| 9 | 路由组织 | 页面内组合 `WorkbenchShell`，不依赖 route group |
| 10 | 桌面端 | 暂不考虑，不改造、不验收 |
| 11 | 代码提交范围 | 默认提交全部工作区改动；勾选仅用于驳回 |
| 12 | 未配置完成脚本 | 二次确认后允许仅本地完成；可配置为 `required` 禁止 |
| 13 | twStatus 归属 | 本地状态；同步不覆盖，天然无防降级问题 |
| 14 | 代码提交后是否自动接受 | 是；提交成功后自动写入 `acceptedAt` |
| 15 | 配置组织方式 | 只维护 `repositories[]` 一套；仓库名、Jenkins Job、项目名、分支都挂在同一条记录上，`repos`/`projectMap`/`branches`/`jenkins.jobs` 派生；`devplatform.appNames`/`codeNameMap` 属 `om/` 不纳入 |
| 16 | 任务字段精简 | 删除 `leval` / `taskType` / `developmentHour` / `factFinish` / `maxHour` / `planStart` / `planEnd` / `factStart` / `version` 及 `handlers[].maxHour`；其余展示字段改为可选 |

### 实施前检查

- 按 `xiaoqian-manager/AGENTS.md` 先读 `node_modules/next/dist/docs/`，确认 Next 16 的页面/路由/重定向写法。
- `repositories[].projects[]` 保存时校验同名项目：允许同一仓库多条；跨仓库同名时要求用 `keywords` 消歧，或在设置页明确确认使用默认条目。
- `yarn setup` 生成的 `example/febot.config.json` 必须同步为新 schema（`repoRoot / jenkinsBase / defaults / repositories[]`），避免首次初始化就落在旧字段上。

---

## 16. 附录：目标目录结构（改造后）

```
xiaoqian-manager/
  app/
    page.tsx                      # 三栏工作台
    runs/[id]/page.tsx            # 重定向到 /?run=
    review/page.tsx               # 独立审阅
    runs/[id]/review/page.tsx     # 独立审阅
    api/
      settings/route.ts
      settings/repos/scan/route.ts
      tasks/route.ts              # GET + POST
      tasks/sync/route.ts         # 适配器编排（本地全量合并）
      runs/[id]/submit-code/route.ts
      task-sources/               # 上传/列表/试运行
      task-sources/[id]/complete-script/route.ts
      tasks/[id]/stages/[stageKey]/route.ts
      # 后续：auth/{send-code,login,register,logout,me}/route.ts
  components/
    workbench/
      WorkbenchShell.tsx
      WorkbenchProvider.tsx
      Sidebar.tsx
      NotificationList.tsx
      UserMenu.tsx                # 本期仅本地占位
      RunPanel.tsx
    settings/SettingsDialog.tsx
    task/NewTaskDialog.tsx
    task/StageDialog.tsx
    sync/SyncDialog.tsx
    pipeline/useRunSession.ts
  lib/
    domain/{schema,pipeline,task-source,settings,notification}.ts
    server/
      config/{store,repos-scan}.ts
      task-sources/{registry,teamwork,script,upload}.ts
      tasks/sync-service.ts
      stages/{registry,handlers/*}
      store.ts
  data/
    tasks.json
    task-sources/<sourceId>/{current,versions,last-run.json}
    # 后续：auth/{users.json,sessions.json}
```