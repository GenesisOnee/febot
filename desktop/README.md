# febot-desktop

febot 桌面端：一个可安装到本机、双击即用的 Windows 应用。桌面壳只做**进程编排**——窗口、托盘、菜单、通知、进程守护、自动更新；产品 UI 仍是现有的 `xiaoqian-manager`（Next.js），前端代码零重写。

- 计划依据：`docs/desktop-app-建设计划书.md`（仓库根）
- 项目位置：`desktop/`，与 `xiaoqian-manager` 同仓；源码仓根由脚本位置推导为仓库根，可用 `FEBOT_SOURCE_ROOT` 覆盖
- 技术栈：Electron 45 + electron-vite 6 + electron-builder 26 + Next 16 standalone + 内置 Node 24 + node-pty 1.1.0（N-API）

## 目录

```text
src/main/          Electron 主进程
  index.ts         应用生命周期、窗口、托盘、菜单、退出时序
  supervisor.ts    Next / runner 子进程状态机、健康检查、退避重启、日志管道
  workspace.ts     工作区创建 / 校验 / 接管 / 运行时同步
  settings.ts      %APPDATA%\febot\desktop.json
  runtime-sync     见 workspace.ts（manifest 三方哈希比对）
  doctor.ts        Git / Claude / Git Bash / Python / Docker / yarn 自检
src/preload/       contextBridge 白名单 API（仅向导与错误页加载）
src/renderer/      首启向导 + 启动失败页（轻量 HTML/TS）
scripts/
  prepare-runtime.mjs   构建 Next standalone / runner bundle / 运行时资产 / 内置 Node / manifest
  make-icon.mjs         生成 build/icon.ico
tests/unit/             manifest 决策、端口分配、工作区创建/同步单测（13 个）
```

## 开发

前置：仓库根已执行 `yarn setup`（含 `xiaoqian-manager` 与 `desktop` 的依赖安装）。

在仓库根执行（壳依赖与产品仓分开安装）：

```bash
yarn desktop:install
yarn --cwd desktop make-icon
yarn desktop:dev
```

开发模式下 Electron 主进程直接拉起：

- `yarn next dev -p <动态端口>`（cwd = `D:\febot\xiaoqian-manager`）
- `yarn runner`（cwd = `D:\febot\xiaoqian-manager`）

并注入 `FEBOT_WORKSPACE` / `FEBOT_CONFIG` / `XQ_RUNNER_PORT` / `XQ_RUNNER_TOKEN` / `FEBOT_DESKTOP_INSTANCE`。

> 开发模式与源码仓的 `yarn dev` 不能同时运行：Next 16 会检测同一目录下的已有 dev server 并拒绝启动。需要同时验证时，用 `FEBOT_DESKTOP_USE_RESOURCES=1 yarn desktop:dev` 走 `resources/` 生产布局。

可用环境变量：

| 变量 | 说明 |
| --- | --- |
| `FEBOT_SOURCE_ROOT` | 源码仓库根，默认由 `desktop/scripts` 上两级推导（即本仓库根） |
| `FEBOT_DESKTOP_WORKSPACE` | 跳过向导，直接使用该工作区（默认接管模式） |
| `FEBOT_DESKTOP_USE_RESOURCES=1` | 开发时也走 `resources/` 生产布局 |
| `FEBOT_DEBUG=1` | 控制台 debug 日志 |

## 构建安装包

在仓库根执行：

```bash
yarn --cwd desktop make-icon
yarn --cwd desktop prepare-runtime   # 构建 Next standalone + runner + runtime + 内置 Node
yarn desktop:dist                    # electron-vite build + electron-builder --win nsis
# 或者只打包目录，便于验证：
yarn --cwd desktop prepare-runtime:fast --skip-build --skip-node
yarn --cwd desktop dist:dir
```

产物：`desktop/dist/febot-Setup-<version>.exe`、`latest.yml`、`*.blockmap`。

> 本机首次打包时 electron-builder 需要下载 electron / nsis 二进制，`.npmrc` 里的镜像配置它不读取，需显式设置环境变量：
>
> ```powershell
> $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
> $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
> yarn dist
> ```
>
> `publish.url` 当前是占位地址，发布前必须替换成真实更新源。

`prepare-runtime.mjs` 会做安全断言：安装包中**不允许**出现构建机的 `data/`、`runner.json`、`.tw-cookie.json`，也不允许出现 `febot.config.json`、`tasks.md`、`file-lock.md`、`.claude/settings.json`、`scripts/hindsight.env`、`swagger-mcp-server/services.conf`。命中即构建失败。

## 工作区模型

```text
安装目录（随安装包/更新变化，不可写）
%LOCALAPPDATA%\Programs\febot\
  febot.exe
  resources\{app.asar, next, runner, runtime, node, runtime-manifest.json}

用户级
%APPDATA%\febot\
  desktop.json    工作区路径、端口、claude 路径、窗口状态
  logs\main.log   next / runner 子进程日志（带前缀）
  backup\<version>-<ts>\   运行时同步前的备份（保留最近 3 份）

工作区（用户选择，应用更新绝不覆盖用户数据）
<workspace>\
  febot.config.json
  tasks.md / file-lock.md
  scripts\ code-indexer\ example\ swagger-mcp-server\ .claude\{commands,agents,skills}
  docs\requirements\
  gitlab\
  .febot\{index,tmp,runtime.json,desktop.lock}
  xiaoqian-manager\data\{tasks.json,runs,temp,repos.json,runner.json}
```

- **新建工作区**：复制 `resources/runtime` 的受管资产，从 `example/` seed 用户文件（只在不存在时）。
- **接管现有目录**：校验 `febot.config.json` / `scripts/advance.mjs` / `.claude/commands/pipeline.md` 至少两项，不复制、不覆盖任何文件，只生成 `.febot/runtime.json` 基线。
- **升级同步**：逐文件三方哈希比对；用户改过的文件不覆盖，写 `<file>.febot-new` 并汇总冲突。

## 中断与恢复

应用退出或 runner 非预期退出时，进行中的 run 落盘为 `interrupted`（不是 `failed`），保留输出、事件与轨迹现场；下次启动可查看现场并恢复会话。仅真实执行错误才置 `failed`。

退出时序：`before-quit` → 有活动 run 时弹确认 → `POST /runner/shutdown` → `taskkill /PID <pid> /T /F` 兜底 → `app.exit(0)`。

## 验证状态（M0）

已在本机实跑通过（详见 `docs/spike-report.md`）：

- 内置 Node 24.22.2 加载 node-pty prebuilds 并 spawn ConPTY
- esbuild 后的 runner 单文件 `/healthz`、`runner.json`、`POST /shutdown`
- Next standalone 在 `resources/next` 布局下的页面与 API
- Electron 壳（开发资源模式 + `dist/win-unpacked/febot.exe`）启动 Next + runner
- 正常退出：runner 优雅关闭、Next 进程树清理、无残留
- 中文/空格工作区路径
- NSIS 安装包构建

仍待人工/目标机确认：

- teamwork / SSO 登录在窗口内的跳转（V7）
- 干净 Windows 11 机器安装、开机启动、卸载保留数据
- 自动更新链路（需要真实更新源与代码签名）
- SmartScreen 拦截（无签名证书）

## 发布

- 自动更新使用 `electron-updater` + generic 源，地址在 `electron-builder.yml` 的 `publish.url`。
- 版本号与运行时资产版本一致（`runtimeVersion`）。
- 无代码签名证书时 SmartScreen 会拦截，需在发布说明中给出处理指引。