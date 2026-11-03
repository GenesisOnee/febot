// 主进程 / preload / 渲染进程共享的类型。禁止 import node 内置模块。

export type ServiceName = "next" | "runner";

export type ServiceState = "stopped" | "starting" | "running" | "restarting" | "failed";

export interface ServiceStatus {
  name: ServiceName;
  state: ServiceState;
  pid: number | null;
  port: number | null;
  restarts: number;
  lastError: string | null;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface DesktopSettings {
  workspace: string;
  /** 新建（受管同步）或接管（不自动覆盖任何现有文件） */
  workspaceMode: "new" | "takeover";
  /** 空 = 从 PATH / %APPDATA%\npm 解析 */
  claudePath: string;
  minimizeToTray: boolean;
  autoLaunchAtLogin: boolean;
  autoUpdate: boolean;
  updateChannel: "stable" | "beta";
  lastWindow: WindowState;
  runtimeVersion: string;
  /** 上次使用的端口；分配失败会自动换端口 */
  appPort: number | null;
  runnerPort: number | null;
  /** 允许在窗口内跳转的外部域名（teamwork / SSO） */
  navigationAllowlist: string[];
}

export interface Bootstrap {
  workspace: string;
  appPort: number;
  runnerPort: number;
  version: string;
  runtimeVersion: string;
  isPackaged: boolean;
}

export interface DoctorItem {
  id: string;
  label: string;
  required: boolean;
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  checkedAt: string;
  items: DoctorItem[];
}

export interface WorkspaceCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export type SetupMode = "new" | "takeover";

export interface SetupConfigInput {
  repoRoot?: string;
  repos?: string[];
  defaultBranch?: string;
}

export interface SetupPayload {
  mode: SetupMode;
  workspace: string;
  config?: SetupConfigInput;
  skipConfigWrite?: boolean;
}

export interface RuntimeSyncResult {
  version: string;
  copied: number;
  skipped: number;
  conflicts: string[];
  backupPath: string | null;
  error: string | null;
}

export interface FebotDesktopApi {
  getBootstrap(): Promise<Bootstrap>;
  getSettings(): Promise<DesktopSettings>;
  saveSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  pickWorkspace(): Promise<string | null>;
  validateWorkspace(dir: string, mode?: SetupMode): Promise<WorkspaceCheck>;
  finishSetup(payload: SetupPayload): Promise<RuntimeSyncResult>;
  openWorkspace(): Promise<void>;
  openLogs(): Promise<void>;
  openExternal(url: string): Promise<void>;
  restartServices(): Promise<void>;
  runDoctor(): Promise<DoctorReport>;
  showMainWindow(): Promise<void>;
  onServiceStatus(cb: (statuses: ServiceStatus[]) => void): () => void;
  onSetupProgress(cb: (message: string) => void): () => void;
}