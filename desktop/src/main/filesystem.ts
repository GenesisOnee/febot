import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256File(file: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export function walkFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function copyFilePreserving(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

export interface CopyDirOptions {
  /** 相对 root 的 posix 路径；返回 false 即跳过 */
  filter?: (relative: string, isDirectory: boolean) => boolean;
}

export function copyDir(srcRoot: string, destRoot: string, options: CopyDirOptions = {}): number {
  if (!fs.existsSync(srcRoot)) return 0;
  let copied = 0;
  const stack = [srcRoot];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, entry.name);
      const rel = toPosix(path.relative(srcRoot, src));
      if (entry.isDirectory()) {
        if (options.filter && !options.filter(rel, true)) continue;
        fs.mkdirSync(path.join(destRoot, rel), { recursive: true });
        stack.push(src);
      } else if (entry.isFile()) {
        if (options.filter && !options.filter(rel, false)) continue;
        copyFilePreserving(src, path.join(destRoot, rel));
        copied += 1;
      }
    }
  }
  return copied;
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 目录可写性探测：真写一个探针文件再删掉。 */
export function isWritableDir(dir: string): boolean {
  const probe = path.join(dir, `.febot-write-test-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, "ok", "utf8");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}