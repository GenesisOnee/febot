import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildManifest, writeManifest } from "../../src/main/manifest";
import { createWorkspace, syncRuntime } from "../../src/main/workspace";

// workspace.ts 只依赖 paths 里的几个纯路径函数；mock 掉以免加载 electron。
vi.mock("../../src/main/paths", async () => {
  const nodePath = await import("node:path");
  const nodeOs = await import("node:os");
  const root = nodePath.join(nodeOs.tmpdir(), "febot-desktop-ws-unit");
  return {
    backupDir: () => nodePath.join(root, "backup"),
    workspaceConfigFile: (ws: string) => nodePath.join(ws, "febot.config.json"),
    workspaceDataDir: (ws: string) => nodePath.join(ws, "xiaoqian-manager", "data"),
    workspaceRuntimeManifest: (ws: string) => nodePath.join(ws, ".febot", "runtime.json"),
  };
});

const root = path.join(os.tmpdir(), "febot-desktop-ws-unit");
const runtimeDir = path.join(root, "runtime");
const workspace = path.join(root, "workspace");
const manifestFile = path.join(root, "runtime-manifest.json");

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  write(path.join(runtimeDir, "scripts", "advance.mjs"), "v1 advance");
  write(path.join(runtimeDir, "example", "febot.config.json"), '{"repoRoot":"./gitlab"}');
  write(path.join(runtimeDir, "example", "tasks.md"), "seed tasks");
  write(path.join(runtimeDir, ".claude", "commands", "pipeline.md"), "v1 pipeline");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("createWorkspace", () => {
  it("复制受管资产并从 example 生成用户文件（不覆盖已存在）", () => {
    fs.mkdirSync(workspace, { recursive: true });
    write(path.join(workspace, "tasks.md"), "user tasks");

    const result = createWorkspace(workspace, runtimeDir, manifestFile, "1.0.0");

    expect(read(path.join(workspace, "scripts", "advance.mjs"))).toBe("v1 advance");
    expect(read(path.join(workspace, ".claude", "commands", "pipeline.md"))).toBe("v1 pipeline");
    // 已存在的用户文件不覆盖
    expect(read(path.join(workspace, "tasks.md"))).toBe("user tasks");
    // 缺失的模板会生成
    expect(read(path.join(workspace, "febot.config.json"))).toBe('{"repoRoot":"./gitlab"}');
    expect(result.created).not.toContain("tasks.md");
    expect(fs.existsSync(path.join(workspace, ".febot", "runtime.json"))).toBe(true);
  });
});

describe("syncRuntime", () => {
  it("同版本下补齐被删除的受管文件", () => {
    createWorkspace(workspace, runtimeDir, manifestFile, "1.0.0");
    fs.rmSync(path.join(workspace, "scripts", "advance.mjs"));

    const result = syncRuntime(workspace, runtimeDir, manifestFile, "1.0.0");

    expect(result.error).toBeNull();
    expect(result.copied).toBe(1);
    expect(read(path.join(workspace, "scripts", "advance.mjs"))).toBe("v1 advance");
  });

  it("版本升级时保留用户改动并写 .febot-new", () => {
    createWorkspace(workspace, runtimeDir, manifestFile, "1.0.0");
    write(path.join(workspace, "scripts", "advance.mjs"), "user changed");

    write(path.join(runtimeDir, "scripts", "advance.mjs"), "v2 advance");
    const next = buildManifest(runtimeDir, "2.0.0");
    writeManifest(manifestFile, next);

    const result = syncRuntime(workspace, runtimeDir, manifestFile, "2.0.0");

    expect(result.error).toBeNull();
    expect(result.conflicts).toContain("scripts/advance.mjs");
    expect(read(path.join(workspace, "scripts", "advance.mjs"))).toBe("user changed");
    expect(read(path.join(workspace, "scripts", "advance.mjs.febot-new"))).toBe("v2 advance");
  });

  it("用户没改过的文件会被新版覆盖", () => {
    createWorkspace(workspace, runtimeDir, manifestFile, "1.0.0");

    write(path.join(runtimeDir, "scripts", "advance.mjs"), "v2 advance");
    const next = buildManifest(runtimeDir, "2.0.0");
    writeManifest(manifestFile, next);

    const result = syncRuntime(workspace, runtimeDir, manifestFile, "2.0.0");

    expect(result.conflicts).toHaveLength(0);
    expect(read(path.join(workspace, "scripts", "advance.mjs"))).toBe("v2 advance");
  });
});