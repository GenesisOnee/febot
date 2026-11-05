import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SourceManifest } from "./script";
import {
  SOURCES_DIR,
  currentDir,
  isSafeSourceId,
  readManifestAt,
  safeRelativePath,
  sourceDir,
  versionsDir,
} from "./script";

// 自定义来源文件夹上传：整包落到 data/task-sources/<sourceId>/current，
// 旧版本归档到 versions/<时间戳>。只接受相对路径与受限体积。

export const MAX_SINGLE_BYTES = 1 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_COUNT = 500;

export interface UploadFile {
  /** 浏览器 webkitRelativePath（含顶层文件夹） */
  path: string;
  data: Buffer;
}

export interface InstallResult {
  sourceId: string;
  manifest: SourceManifest;
}

export class UploadError extends Error {}

/** 从 multipart 表单读取 files[]；File.name 里应带相对路径（前端用 webkitRelativePath 重命名） */
export async function readUploadForm(form: FormData): Promise<UploadFile[]> {
  const entries = form.getAll("files");
  const out: UploadFile[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const file = entry as File;
    if (typeof file.arrayBuffer !== "function") continue;
    const name = typeof file.name === "string" ? file.name : "";
    if (!name) continue;
    out.push({ path: name, data: Buffer.from(await file.arrayBuffer()) });
  }
  return out;
}

function newSourceId(manifestName?: string): string {
  const base = (manifestName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const rand = crypto.randomBytes(4).toString("hex");
  return `${base ? `${base}-` : ""}src-${rand}`;
}

/** 所有文件同处一个顶层文件夹时去掉它，避免 current 里多套一层 */
function stripCommonRoot(paths: string[]): string[] {
  if (paths.length < 2) return paths;
  const firsts = paths.map((p) => p.split("/")[0]);
  const shared = firsts.every((f) => f === firsts[0]);
  if (!shared) return paths;
  if (paths.some((p) => p.split("/").length < 2)) return paths;
  return paths.map((p) => p.split("/").slice(1).join("/"));
}

function validateUpload(files: UploadFile[]): UploadFile[] {
  if (!files.length) throw new UploadError("没有收到文件");
  if (files.length > MAX_FILE_COUNT) {
    throw new UploadError(`文件数量超过上限（${MAX_FILE_COUNT}）`);
  }
  let total = 0;
  const cleaned: UploadFile[] = [];
  for (const f of files) {
    if (f.data.length > MAX_SINGLE_BYTES) {
      throw new UploadError(`文件过大（>1MB）：${f.path}`);
    }
    total += f.data.length;
    if (total > MAX_TOTAL_BYTES) {
      throw new UploadError("上传内容超过 20MB");
    }
    cleaned.push(f);
  }

  const rawPaths = cleaned.map((f) => f.path.replace(/\\/g, "/"));
  const stripped = stripCommonRoot(rawPaths);
  const seen = new Set<string>();
  return cleaned.map((f, i) => {
    const rel = safeRelativePath(stripped[i]);
    if (!rel) throw new UploadError(`非法文件路径：${f.path}`);
    if (seen.has(rel.toLowerCase())) throw new UploadError(`重复文件：${rel}`);
    seen.add(rel.toLowerCase());
    return { path: rel, data: f.data };
  });
}

function writeFiles(dir: string, files: UploadFile[]): void {
  for (const f of files) {
    const target = path.resolve(dir, ...f.path.split("/"));
    const relCheck = path.relative(path.resolve(dir), target);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      throw new UploadError(`路径越界：${f.path}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
  }
}

function archiveCurrent(sourceId: string): void {
  const current = currentDir(sourceId);
  if (!fs.existsSync(current)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(versionsDir(sourceId), stamp);
  fs.mkdirSync(versionsDir(sourceId), { recursive: true });
  fs.renameSync(current, dest);
}

/** 安装（或整包替换）一个脚本来源。校验失败时磁盘保持原样。 */
export function installSource(files: UploadFile[], sourceId?: string): InstallResult {
  const normalized = validateUpload(files);

  const temp = path.join(SOURCES_DIR, `.tmp-${crypto.randomBytes(6).toString("hex")}`);
  fs.mkdirSync(temp, { recursive: true });
  try {
    writeFiles(temp, normalized);
    const manifest = readManifestAt(temp);
    if (!manifest) throw new UploadError("缺少 febot.source.json 或格式不合法");
    const id = sourceId ?? newSourceId(manifest.name);
    if (!isSafeSourceId(id)) throw new UploadError(`非法来源 ID：${id}`);
    fs.mkdirSync(sourceDir(id), { recursive: true });
    archiveCurrent(id);
    fs.renameSync(temp, currentDir(id));
    return { sourceId: id, manifest };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * 只更新完成脚本：文件直接合并进 current，不整包替换拉取脚本。
 * 若上传里带 febot.source.json，只取其 complete 段合并进现有 manifest。
 */
export function installCompleteScript(sourceId: string, files: UploadFile[]): SourceManifest {
  if (!isSafeSourceId(sourceId)) throw new UploadError(`非法来源 ID：${sourceId}`);
  const dir = currentDir(sourceId);
  if (!fs.existsSync(path.join(dir, "febot.source.json"))) {
    throw new UploadError(`来源不存在或缺少 manifest：${sourceId}`);
  }
  const normalized = validateUpload(files);

  const manifestFile = normalized.find((f) => f.path === "febot.source.json");
  const rest = normalized.filter((f) => f.path !== "febot.source.json");
  writeFiles(dir, rest);

  if (manifestFile) {
    const existingPath = path.join(dir, "febot.source.json");
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(existingPath, "utf8")) as Record<string, unknown>;
    } catch {
      // 现有 manifest 坏了：直接报错，避免覆盖成半截
      throw new UploadError("现有 febot.source.json 不是合法 JSON");
    }
    let incoming: Record<string, unknown> = {};
    try {
      incoming = JSON.parse(manifestFile.data.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new UploadError("上传的 febot.source.json 不是合法 JSON");
    }
    const merged = { ...existing };
    if (incoming.complete && typeof incoming.complete === "object") {
      merged.complete = incoming.complete;
    } else {
      delete merged.complete;
    }
    fs.writeFileSync(existingPath, JSON.stringify(merged, null, 2), "utf8");
  } else if (!readManifestAt(dir)?.complete) {
    // 只传了一个脚本、没带 manifest：按约定自动登记为完成脚本
    const scripts = rest.filter((f) => /\.(mjs|cjs|js)$/i.test(f.path));
    if (scripts.length === 1) {
      const existingPath = path.join(dir, "febot.source.json");
      const existing = JSON.parse(fs.readFileSync(existingPath, "utf8")) as Record<string, unknown>;
      existing.complete = { entry: scripts[0].path, timeoutMs: 60_000, mode: "optional" };
      fs.writeFileSync(existingPath, JSON.stringify(existing, null, 2), "utf8");
    }
  }

  const manifest = readManifestAt(dir);
  if (!manifest) throw new UploadError("更新后 manifest 不合法");
  if (!manifest.complete) throw new UploadError("更新后仍未配置 complete 段");
  return manifest;
}

/** 删除来源：整目录移除（含历史版本） */
export function deleteSource(sourceId: string): boolean {
  if (!isSafeSourceId(sourceId)) return false;
  const dir = sourceDir(sourceId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}