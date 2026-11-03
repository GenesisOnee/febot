import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { countActiveRuns } from "./runs";
import { log } from "./logging";
import { notifySimple } from "./notifications";

export interface UpdaterOptions {
  workspace: () => string;
  /** 返回 true 表示允许此刻退出重启 */
  canRestart: () => boolean;
}

let started = false;

export function initUpdater(options: UpdaterOptions): void {
  if (!app.isPackaged || started) return;
  started = true;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  const check = async (): Promise<void> => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      log.warn("[updater] 检查更新失败", e);
    }
  };

  autoUpdater.on("update-available", (info) => {
    log.info(`[updater] 发现新版本 ${info.version}`);
    notifySimple("发现新版本", `febot ${info.version} 正在后台下载`);
  });

  autoUpdater.on("error", (e) => {
    log.warn("[updater] error", e);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const active = countActiveRuns(options.workspace());
    if (active > 0) {
      notifySimple("更新已就绪", `有 ${active} 个任务进行中，退出后会安装更新（下次启动可恢复会话）`);
      return;
    }
    if (!options.canRestart()) return;
    const result = await dialog.showMessageBox({
      type: "info",
      title: "更新已就绪",
      message: `febot ${info.version} 已下载完成`,
      detail: "立即重启并安装更新？",
      buttons: ["立即重启", "稍后"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  // 启动 5 分钟后检查一次，之后每 4 小时
  setTimeout(() => void check(), 5 * 60 * 1000).unref();
  setInterval(() => void check(), 4 * 60 * 60 * 1000).unref();
}

export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: "info",
      title: "检查更新",
      message: "开发模式不检查更新",
    });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      await dialog.showMessageBox({
        type: "info",
        title: "检查更新",
        message: "当前已是最新版本",
      });
    }
  } catch (e) {
    await dialog.showMessageBox({
      type: "warning",
      title: "检查更新失败",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}