import type { Task } from "@/lib/domain/schema";
import type { RawTask, TaskSource, TaskSourceCompleteResult, TaskSourceContext } from "@/lib/domain/task-source";
import { readTeamworkConfig } from "@/lib/server/config/store";
import { hasCredentials } from "@/lib/server/teamwork/credentials";
import {
  fetchDemandTasks,
  fetchDetail,
  fetchList,
  fetchRecord,
  pushDevOperation,
} from "@/lib/server/teamwork/client";
import { rowToTask } from "@/lib/server/teamwork/mapper";

// 内置协作平台适配器：包装现有取数客户端与 mapper，行为不变。

export interface TeamworkParams {
  user?: string;
  statuses?: string[];
  module?: string;
}

function paramsOf(ctx: TaskSourceContext): TeamworkParams {
  const p = (ctx.params ?? {}) as TeamworkParams;
  return {
    user: typeof p.user === "string" ? p.user.trim() : "",
    statuses: Array.isArray(p.statuses) ? p.statuses.map(String) : [],
    module: typeof p.module === "string" ? p.module.trim() : "",
  };
}

function toRaw(task: Task): RawTask {
  return {
    externalId: task.id,
    title: task.title,
    module: task.module,
    assignee: task.assignee,
    customerName: task.customerName,
    twStatus: task.twStatus,
    demandId: task.demandId,
    demandLevel: task.demandLevel,
    description: task.description,
    assignDescription: task.assignDescription,
    attachments: task.attachments.length ? task.attachments : undefined,
    handlers: task.handlers.length ? task.handlers : undefined,
    trajectory: task.trajectory,
    createdName: task.createdName,
    createdTime: task.createdTime,
  };
}

export const teamworkSource: TaskSource = {
  id: "teamwork",
  name: "协作平台",
  kind: "builtin",

  async fetchTasks(ctx) {
    if (!hasCredentials()) {
      throw new Error(
        "未配置协作平台账号：请在 febot.config.json 的 teamwork.loginName / teamwork.password 填写",
      );
    }
    const p = paramsOf(ctx);
    const statuses = p.statuses?.length ? p.statuses : ["1", "2"];
    const user = p.user || readTeamworkConfig().username;
    if (!user) {
      throw new Error(
        "未指定执行人：请在 febot.config.json 的 teamwork.username 配置默认值，或在同步弹窗里填写",
      );
    }
    const rows = await fetchList({ statuses, user, module: p.module ?? "", pageSize: 50 });
    const out: RawTask[] = [];
    for (const row of rows) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const demandId = String(row.demand_id ?? "");
      const [detail, traj, demandTasks] = await Promise.all([
        fetchDetail(id),
        fetchRecord(demandId),
        fetchDemandTasks(demandId),
      ]);
      out.push(toRaw(rowToTask(row, detail, traj, demandTasks)));
    }
    return out;
  },

  async complete(task): Promise<TaskSourceCompleteResult> {
    await pushDevOperation(task.id, task.plannedDescription);
    return { ok: true, message: "已回写协作平台", remoteStatus: "已完成" };
  },
};