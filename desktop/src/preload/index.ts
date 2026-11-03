import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/constants";
import type { DesktopSettings, FebotDesktopApi, ServiceStatus } from "../shared/types";

// contextBridge 只暴露白名单 API；主窗口不加载 preload，产品 UI 无法触达 Node。
const api: FebotDesktopApi = {
  getBootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch: Partial<DesktopSettings>) => ipcRenderer.invoke(IPC.saveSettings, patch),
  pickWorkspace: () => ipcRenderer.invoke(IPC.pickWorkspace),
  validateWorkspace: (dir: string, mode) =>
    ipcRenderer.invoke(IPC.validateWorkspace, dir, mode),
  finishSetup: (payload) => ipcRenderer.invoke(IPC.finishSetup, payload),
  openWorkspace: () => ipcRenderer.invoke(IPC.openWorkspace),
  openLogs: () => ipcRenderer.invoke(IPC.openLogs),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  restartServices: () => ipcRenderer.invoke(IPC.restartServices),
  runDoctor: () => ipcRenderer.invoke(IPC.runDoctor),
  showMainWindow: () => ipcRenderer.invoke(IPC.showMainWindow),
  onServiceStatus: (cb: (statuses: ServiceStatus[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, statuses: ServiceStatus[]): void => cb(statuses);
    ipcRenderer.on(IPC.serviceStatus, listener);
    return () => ipcRenderer.removeListener(IPC.serviceStatus, listener);
  },
  onSetupProgress: (cb: (message: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, message: string): void => cb(message);
    ipcRenderer.on(IPC.setupProgress, listener);
    return () => ipcRenderer.removeListener(IPC.setupProgress, listener);
  },
};

contextBridge.exposeInMainWorld("febotDesktop", api);