import fs from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { DoctorItem, DoctorReport } from "../shared/types";
import { claudeCandidates, commonGitBashPaths, enrichedPath, resolveClaude } from "./env";

const execAsync = promisify(exec);

interface RunResult {
  ok: boolean;
  output: string;
}

async function run(command: string, timeout = 8_000): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      windowsHide: true,
      env: { ...process.env, PATH: enrichedPath() },
      shell: "cmd.exe",
    });
    const output = `${stdout}${stderr}`.split(/\r?\n/).find((l) => l.trim()) ?? "";
    return { ok: true, output: output.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message || "执行失败";
    return { ok: false, output };
  }
}

export async function runDoctor(claudePath = ""): Promise<DoctorReport> {
  const items: DoctorItem[] = [];

  const git = await run("git --version");
  items.push({
    id: "git",
    label: "Git",
    required: true,
    ok: git.ok,
    detail: git.ok ? git.output : "未找到 git",
    fix: "安装 Git for Windows，并勾选“Git from the command line and also from 3rd-party software”",
  });

  const resolvedClaude = resolveClaude(claudePath);
  let claudeOk = Boolean(resolvedClaude);
  let claudeDetail = resolvedClaude ?? "未找到 claude";
  if (!claudeOk) {
    const claude = await run("claude --version");
    claudeOk = claude.ok;
    claudeDetail = claude.output;
  } else {
    const version = await run(`"${resolvedClaude}" --version`);
    if (version.ok) claudeDetail = `${resolvedClaude} · ${version.output}`;
  }
  items.push({
    id: "claude",
    label: "Claude Code",
    required: true,
    ok: claudeOk,
    detail: claudeDetail,
    fix:
      claudeCandidates(claudePath).length > 0
        ? "已找到候选但无法执行，请在设置里指定 claude 绝对路径"
        : "安装 Claude Code（npm i -g @anthropic-ai/claude-code），或在设置里指定 claude 绝对路径",
  });

  const bashPath = commonGitBashPaths().find((p) => fs.existsSync(p));
  let bashOk = Boolean(bashPath);
  let bashDetail = bashPath ?? "未找到 Git Bash";
  if (!bashOk) {
    const bash = await run("bash --version");
    bashOk = bash.ok;
    bashDetail = bash.output;
  } else {
    const v = await run(`"${bashPath}" --version`);
    if (v.ok) bashDetail = `${bashPath} · ${v.output}`;
  }
  items.push({
    id: "bash",
    label: "Git Bash",
    required: true,
    ok: bashOk,
    detail: bashDetail,
    fix: "安装 Git for Windows（自带 Git Bash）",
  });

  const py = await run("py -3 --version").then(async (r) => (r.ok ? r : run("python --version")));
  items.push({
    id: "python",
    label: "Python 3",
    required: false,
    ok: py.ok,
    detail: py.ok ? py.output : "未找到 python（hindsight 相关脚本不可用）",
    fix: "安装 Python 3 并勾选 Add to PATH；不使用 hindsight 时可忽略",
  });

  const docker = await run("docker --version");
  items.push({
    id: "docker",
    label: "Docker",
    required: false,
    ok: docker.ok,
    detail: docker.ok ? docker.output : "未找到 docker（Hindsight 服务不可用）",
    fix: "安装 Docker Desktop；不使用 hindsight 时可忽略",
  });

  const yarn = await run("yarn --version");
  items.push({
    id: "yarn",
    label: "yarn",
    required: false,
    ok: yarn.ok,
    detail: yarn.ok ? yarn.output : "未找到 yarn",
    fix: "npm i -g yarn@1.22.19；仅开发模式与目标仓脚本需要",
  });

  return {
    ok: items.filter((i) => i.required).every((i) => i.ok),
    checkedAt: new Date().toISOString(),
    items,
  };
}