import path from "node:path";
import { app } from "electron";

// 用户级目录固定为 %APPDATA%\febot，与 Electron 默认 userData 可能随包名漂移解耦。
// 工作区数据永远在用户选择的工作区里，这里只放桌面设置、日志与更新缓存。

export function appDataDir(): string {
  return path.join(app.getPath("appData"), "febot");
}

export function logsDir(): string {
  return path.join(appDataDir(), "logs");
}

export function backupDir(): string {
  return path.join(appDataDir(), "backup");
}

export function settingsFile(): string {
  return path.join(appDataDir(), "desktop.json");
}

/** 打包后是 resources/；开发时是项目根的 resources/ */
export function resourcesRoot(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources");
}

export function packagedNodeExe(): string {
  return path.join(resourcesRoot(), "node", "node.exe");
}

export function packagedNextServer(): string {
  return path.join(resourcesRoot(), "next", "server.js");
}

export function packagedNextRoot(): string {
  return path.join(resourcesRoot(), "next");
}

export function packagedRunner(): string {
  return path.join(resourcesRoot(), "runner", "server.mjs");
}

export function packagedRuntime(): string {
  return path.join(resourcesRoot(), "runtime");
}

export function packagedManifest(): string {
  return path.join(resourcesRoot(), "runtime-manifest.json");
}

/** 工作区内的固定布局（与现有仓库一致） */
export function workspaceDataDir(workspace: string): string {
  return path.join(workspace, "xiaoqian-manager", "data");
}

export function workspaceRunsDir(workspace: string): string {
  return path.join(workspaceDataDir(workspace), "runs");
}

export function workspaceConfigFile(workspace: string): string {
  return path.join(workspace, "febot.config.json");
}

export function workspaceRuntimeManifest(workspace: string): string {
  return path.join(workspace, ".febot", "runtime.json");
}