import WorkbenchShell from "@/components/workbench/WorkbenchShell";
import { readTasks } from "@/lib/server/store";
import { readGitOptions } from "@/lib/server/git/config";
import {
  isInitialized,
  readSanitizedSettings,
  readTeamworkConfig,
} from "@/lib/server/config/store";
import type { SanitizedSettings } from "@/lib/domain/settings";
import type { Task } from "@/lib/domain/schema";
import { EMPTY_GIT_OPTIONS, type GitOptions } from "@/lib/domain/git";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ run?: string | string[] }>;
}) {
  const sp = await searchParams;
  const runId = Array.isArray(sp.run) ? sp.run[0] : sp.run;

  let tasks: Task[] = [];
  let error = "";
  try {
    tasks = readTasks().tasks;
  } catch (e) {
    error = e instanceof Error ? e.message : "读取任务数据失败";
  }

  // 配置缺失不影响工作台渲染；首次启动由设置弹窗引导补齐
  let gitOptions: GitOptions = EMPTY_GIT_OPTIONS;
  try {
    gitOptions = readGitOptions();
  } catch {
    // 保持空选项
  }

  let defaultUser = "";
  let settings: SanitizedSettings | null = null;
  let initialized = false;
  try {
    defaultUser = readTeamworkConfig().username;
  } catch {
    // 保持空
  }
  try {
    settings = readSanitizedSettings();
    initialized = isInitialized();
  } catch {
    initialized = false;
  }

  return (
    <WorkbenchShell
      initialTasks={tasks}
      initialRunId={runId?.trim() || null}
      gitOptions={gitOptions}
      defaultUser={defaultUser}
      settings={settings}
      initialized={initialized}
      error={error}
    />
  );
}