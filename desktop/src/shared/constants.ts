export const APP_ID = "com.example.febot";
export const PRODUCT_NAME = "febot";

/** 本地服务默认端口（可被动态端口替换） */
export const DEFAULT_APP_PORT = 3010;
export const DEFAULT_RUNNER_PORT = 3011;

/** Next 就绪超时 / runner 就绪超时 */
export const NEXT_READY_TIMEOUT_MS = 60_000;
export const RUNNER_READY_TIMEOUT_MS = 30_000;

/** 子进程异常退出后的退避重启间隔（最多 5 次） */
export const RESTART_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

export const IPC = {
  bootstrap: "febot:bootstrap",
  getSettings: "febot:get-settings",
  saveSettings: "febot:save-settings",
  pickWorkspace: "febot:pick-workspace",
  validateWorkspace: "febot:validate-workspace",
  finishSetup: "febot:finish-setup",
  openWorkspace: "febot:open-workspace",
  openLogs: "febot:open-logs",
  openExternal: "febot:open-external",
  restartServices: "febot:restart-services",
  runDoctor: "febot:run-doctor",
  showMainWindow: "febot:show-main-window",
  serviceStatus: "febot:service-status",
  setupProgress: "febot:setup-progress",
} as const;