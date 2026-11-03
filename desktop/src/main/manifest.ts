import fs from "node:fs";
import path from "node:path";
import { sha256File, toPosix, walkFiles, writeJsonAtomic } from "./filesystem";

// 运行时资产同步：受管文件清单 + 三方哈希比对。
//
// 工作区里每个受管文件有三种状态：
//   1. 不存在                     → 复制
//   2. 与旧 manifest 哈希一致     → 用户没改过，用新版覆盖
//   3. 与新 manifest 哈希一致     → 已是最新，跳过
//   4. 与两者都不同               → 用户改过，不覆盖，写 .febot-new 并记冲突

export interface RuntimeManifest {
  version: string;
  files: Record<string, string>;
}

export type SyncAction = "copy" | "overwrite" | "skip" | "conflict";

export interface SyncDecisionInput {
  /** 工作区文件当前哈希；文件不存在为 null */
  currentSha: string | null;
  oldSha: string | null;
  newSha: string;
}

/** 纯决策函数，便于单测。 */
export function decideSyncAction(input: SyncDecisionInput): SyncAction {
  if (input.currentSha === null) return "copy";
  if (input.currentSha === input.newSha) return "skip";
  if (input.oldSha !== null && input.currentSha === input.oldSha) return "overwrite";
  return "conflict";
}

export function buildManifest(runtimeDir: string, version: string): RuntimeManifest {
  const files: Record<string, string> = {};
  for (const file of walkFiles(runtimeDir)) {
    files[toPosix(path.relative(runtimeDir, file))] = sha256File(file);
  }
  return { version, files };
}

export function readManifest(file: string): RuntimeManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as RuntimeManifest;
    if (!raw || typeof raw !== "object" || !raw.files) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeManifest(file: string, manifest: RuntimeManifest): void {
  writeJsonAtomic(file, manifest);
}