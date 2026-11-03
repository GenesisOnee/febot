import path from "node:path";
import { fileURLToPath } from "node:url";

// runner 侧的固定路径。全部从本文件位置推导，避免依赖启动时的 cwd。
// lib/runner/paths.ts → 项目根 = ../..
const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(HERE, "..", "..");
/**
 * 工作区根（febot 根），PTY 的固定工作目录。
 *
 * 桌面端由 Electron 注入 FEBOT_WORKSPACE；本地开发回退到本应用的上级目录。
 * 生产打包后 server.mjs 位于 resources/runner，import.meta.url 推导出的
 * PROJECT_ROOT 不再是仓库结构，因此桌面端必须显式注入。
 */
export const FEBOT_ROOT = process.env.FEBOT_WORKSPACE?.trim()
  ? path.resolve(process.env.FEBOT_WORKSPACE.trim())
  : path.resolve(PROJECT_ROOT, "..");

/** 数据目录：始终与工作区布局一致（<workspace>/xiaoqian-manager/data） */
export const DATA_DIR = path.join(FEBOT_ROOT, "xiaoqian-manager", "data");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const TEMP_DIR = path.join(DATA_DIR, "temp");
export const REPOS_FILE = path.join(DATA_DIR, "repos.json");
export const RUNNER_INFO_FILE = path.join(DATA_DIR, "runner.json");

export function runFile(taskId: string): string {
  return path.join(RUNS_DIR, `${taskId}.json`);
}

export function eventsFile(taskId: string): string {
  return path.join(RUNS_DIR, `${taskId}.events.jsonl`);
}

export function doneMarker(taskId: string): string {
  return path.join(TEMP_DIR, `${taskId}.done.json`);
}

export function planFile(taskId: string): string {
  return path.join(TEMP_DIR, `${taskId}.md`);
}

export function wrapperFile(taskId: string): string {
  return path.join(TEMP_DIR, `${taskId}.run.cmd`);
}

/** taskId 会进文件名与批处理内容，只放行安全字符 */
export const SAFE_ID = /^[A-Za-z0-9_-]+$/;
