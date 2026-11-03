import path from "node:path";
import { app, Menu, Tray, nativeImage } from "electron";
import type { ServiceStatus } from "../shared/types";

export interface TrayActions {
  showMain: () => void;
  restartServices: () => void;
  openWorkspace: () => void;
  openLogs: () => void;
  quit: () => void;
}

export interface TrayHandle {
  tray: Tray;
  update: (statuses: ServiceStatus[]) => void;
}

function iconPath(): string {
  const candidates = [
    path.join(process.resourcesPath, "build", "icon.ico"),
    path.join(app.getAppPath(), "build", "icon.ico"),
  ];
  return candidates.find((p) => {
    try {
      return require("node:fs").existsSync(p);
    } catch {
      return false;
    }
  }) ?? "";
}

export function createTray(actions: TrayActions): TrayHandle {
  const file = iconPath();
  const image = file ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
  const tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(file) : image);
  tray.setToolTip("febot");

  let statuses: ServiceStatus[] = [];
  const rebuild = (): void => {
    const statusLine = statuses.map((s) => `${s.name}: ${s.state}`).join(" · ") || "服务未启动";
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "显示主窗口", click: actions.showMain },
        { label: `服务状态：${statusLine}`, enabled: false },
        { type: "separator" },
        { label: "重启服务", click: actions.restartServices },
        { label: "打开工作区", click: actions.openWorkspace },
        { label: "打开日志目录", click: actions.openLogs },
        { type: "separator" },
        { label: "退出", click: actions.quit },
      ])
    );
  };

  rebuild();
  tray.on("double-click", actions.showMain);
  return {
    tray,
    update: (next) => {
      statuses = next;
      rebuild();
    },
  };
}