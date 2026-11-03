import fs from "node:fs";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  Bootstrap,
  DesktopSettings,
  DoctorReport,
  RuntimeSyncResult,
  SetupPayload,
  WorkspaceCheck,
} from "../shared/types";
import { IPC } from "../shared/constants";
import { logsDir, workspaceConfigFile } from "./paths";

export interface IpcContext {
  bootstrap: () => Bootstrap;
  settings: () => DesktopSettings;
  saveSettings: (patch: Partial<DesktopSettings>) => DesktopSettings;
  validateWorkspace: (dir: string, mode?: "new" | "takeover") => WorkspaceCheck;
  finishSetup: (payload: SetupPayload) => Promise<RuntimeSyncResult>;
  restartServices: () => Promise<void>;
  runDoctor: () => Promise<DoctorReport>;
  openWorkspace: () => Promise<void>;
  showMainWindow: () => Promise<void>;
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle(IPC.bootstrap, () => ctx.bootstrap());
  ipcMain.handle(IPC.getSettings, () => ctx.settings());
  ipcMain.handle(IPC.saveSettings, (_e, patch: Partial<DesktopSettings>) =>
    ctx.saveSettings(patch)
  );

  ipcMain.handle(IPC.pickWorkspace, async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 febot 工作区",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC.validateWorkspace, (_e, dir: string, mode?: "new" | "takeover") =>
    ctx.validateWorkspace(dir, mode)
  );

  ipcMain.handle(IPC.finishSetup, (_e, payload: SetupPayload) => ctx.finishSetup(payload));

  ipcMain.handle(IPC.openWorkspace, async () => {
    await ctx.openWorkspace();
  });

  ipcMain.handle(IPC.openLogs, async () => {
    fs.mkdirSync(logsDir(), { recursive: true });
    await shell.openPath(logsDir());
  });

  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle(IPC.restartServices, async () => {
    await ctx.restartServices();
  });

  ipcMain.handle(IPC.runDoctor, () => ctx.runDoctor());

  ipcMain.handle(IPC.showMainWindow, async () => {
    await ctx.showMainWindow();
  });
}

export function openConfigFile(workspace: string): Promise<string> {
  return shell.openPath(workspaceConfigFile(workspace));
}