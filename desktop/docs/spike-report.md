# febot 桌面端 M0 Spike 记录

> 日期：2026-11-02
> 项目位置：`desktop/`，与 `xiaoqian-manager` 同仓；源码仓根由脚本位置推导为仓库根，可用 `FEBOT_SOURCE_ROOT` 覆盖
> 结论：**M0 的 V1–V6 已在本机实跑通过；V7（teamwork / SSO 登录）需要人工交互，未验证。NSIS 安装包已成功构建，但尚未在干净机器上安装验证。**

## 已完成并实跑的验证

| # | 验证 | 结果 | 实测要点 |
| --- | --- | --- | --- |
| V1 | Next standalone 实跑 | ✅ 通过 | `resources/next/server.js` 在 `FEBOT_WORKSPACE` 指向的工作区下启动；`GET /` 200（20,180 字节），标题「小前 · 前端工作流」 |
| V2 | 内置 Node 24 跑 node-pty | ✅ 通过 | `resources/node/node.exe` v24.22.2，加载 `resources/runner/node_modules/node-pty`，ConPTY spawn `cmd.exe` 输出 `PTY_OK`，退出码 0 |
| V3 | runner 打包实跑 | ✅ 通过 | 内置 Node 跑 `resources/runner/server.mjs`：`/healthz` 200、`runner.json` 写入工作区、`POST /shutdown`（`x-internal-token`）正常退出 |
| V4 | Electron 最小壳 | ✅ 通过 | 两种模式均实跑：开发资源模式（`resources/`）与 `dist/win-unpacked/febot.exe`；主窗口加载 Next 页面，Next + runner 全部就绪约 1–10s |
| V5 | 进程树清理 | ✅ 通过 | 正常退出流程（冒烟钩子触发 `quitFlow`）：runner 收到 `/shutdown` 并 exit 0 → Next 被 `taskkill /T /F` → 日志 `bye` → 无残留监听端口、无 electron 进程 |
| V6 | 中文/空格路径 | ✅ 通过 | 工作区 `D:\测试 工作区\febot`：校验、端口分配、Next、runner、`runner.json`、退出全部正常 |
| V7 | teamwork / SSO 登录 | ⏳ 待人工 | 需要在窗口内实际登录；导航白名单逻辑已实现（`settings.navigationAllowlist` + `febot.config.json` 的 `desktop.navigationAllowlist` / `teamwork.base`） |

补充实测：

- 动态端口：本机 3010/3011 被既有 `next dev` / runner 占用时，桌面端正确分配到 5xxxx 端口；端口探测先 `connect` 再试监听，避免 Windows `SO_REUSEADDR` 误判。
- 服务身份校验：Next 以随机 `FEBOT_DESKTOP_INSTANCE` 经 `/api/desktop/identity` 确认；runner 以 `/healthz` 的 `pid` 与子进程 pid 对齐，避免把端口上的其他服务误判为就绪。
- 启动耗时：`resources/` 生产布局下 `startApp` 约 1s（Next ready 0.3s + runner 0.2s + 校验/端口）。
- 首次接管基线：改为服务启动后后台生成（`ensureTakeoverBaseline`），且不再对 5000+ 个资源文件做全量哈希，避免首次启动被 Defender 冷扫描拖到 50s+。

## 打包验证

- `electron-builder --win --dir`：成功，产物 `dist/win-unpacked/febot.exe`。
- `electron-builder --win nsis`：成功，产物 `dist/febot-Setup-0.1.0.exe`（约 163 MB）、`latest.yml`、`.blockmap`。
- **踩坑（已修）**：electron-builder 会排除 `extraResources` 源目录根部的 `node_modules`，导致 standalone 报 `Cannot find module 'next'`、runner 报 `Cannot find package 'node-pty'`。`electron-builder.yml` 已改成拆分配置：
  ```yaml
  - from: resources/next
    to: next
    filter: ["**/*", "!node_modules/**"]
  - from: resources/next/node_modules
    to: next/node_modules
    filter: ["**/*"]
  ```
  runner 同理。
- 本机首次打包时 electron-builder 下载二进制失败，需带镜像环境变量：
  ```powershell
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  yarn dist
  ```
  注意：`.npmrc` 里的 `electron_builder_binaries_mirror` 不会被 electron-builder 读取。
- `publish.url` 仍是占位符 `https://updates.example.com/febot/`，发布前必须替换。

## 安装包安全检查

对 `dist/win-unpacked/resources` 做了扫描：

- 不含 `runner.json`、`.tw-cookie.json`、任何 `data/` 目录。
- 不含工作区根级 `febot.config.json` / `tasks.md` / `file-lock.md` / `.claude/settings*.json` / `scripts/hindsight.env` / `swagger-mcp-server/services.conf`。
- 唯一命中的同名文件在 `resources/runtime/example/`，它们是新建工作区的 seed 模板（`example/febot.config.json` 为占位配置，不是构建机真实配置），属于预期产物。
- `app.asar`（8.3 MB，1110 个文件）只含 `out/**`、`package.json` 与生产依赖，无构建机数据。

## 尚未验证 / 已知风险

| 项 | 说明 |
| --- | --- |
| V7 登录 | 需人工在窗口内完成 teamwork / SSO 登录；必要时把 SSO 域名写入 `desktop.navigationAllowlist` |
| 干净机安装 | 未在未装 Node/Git 的 Windows 11 上走完 NSIS 安装、开机启动、卸载保留数据 |
| 自动更新 | `electron-updater` 代码就绪，但无真实更新源与签名，未验证升级链路 |
| SmartScreen | 无代码签名证书，安装包会被 SmartScreen 拦截 |
| Node 24 与 node-pty | 本机验证通过（N-API prebuilds）；仍需覆盖无 VS Build Tools 的干净机 |
| 开发模式 | `next dev` 会检测同目录已有 dev server（Next 16 行为），桌面端开发模式不能与 `yarn dev` 同时跑；生产布局不受影响 |
| 新建工作区向导 | `createWorkspace` / `syncRuntime` 有单测覆盖（复制、seed 不覆盖、缺失补齐、冲突写 `.febot-new`、未改动覆盖），但向导 UI 未做端到端点击验证 |
| 系统 Node 25 的 rmSync 崩溃 | 实测 Node 25.0.0 在 `fs.rmSync("D:\测试 工作区")` 时静默退出（127），Node 24.22.2 正常；应用运行时固定使用内置 Node 24，不受影响 |

## 红灯备选（未触发）

- **V2 失败**：构建机安装 VS Build Tools，针对内置 Node 重编译 node-pty；或退回 `@homebridge/node-pty-prebuilt-multiarch`。
- **V1 失败**：退回 `next start` + 全量 `node_modules`。
- **V7 导航拦截**：把 SSO 域名写入 `febot.config.json` 的 `desktop.navigationAllowlist`。

## 版本基线

| 组件 | 版本 |
| --- | --- |
| Electron | 45.2.1 |
| electron-vite | 6.0.0 |
| electron-builder | 26.18.0 |
| electron-log | 5.4.4 |
| electron-updater | 6.8.11 |
| Next | 16.3.7（沿用，不升级） |
| node-pty | 1.1.0（N-API prebuilds / win32-x64） |
| 内置 Node | 24.22.2 win-x64 |
| 安装包 | febot-Setup-0.1.0.exe（NSIS，per-user） |