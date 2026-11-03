import crypto from "node:crypto";
import path from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { ServiceName, ServiceStatus } from "../shared/types";
import {
  NEXT_READY_TIMEOUT_MS,
  RESTART_DELAYS_MS,
  RUNNER_READY_TIMEOUT_MS,
} from "../shared/constants";
import { allocatePorts, findFreePort } from "./ports";
import { enrichedPath } from "./env";
import { childLog, log } from "./logging";
import { workspaceConfigFile, workspaceDataDir } from "./paths";

const isWin = process.platform === "win32";

interface Managed {
  name: ServiceName;
  child: ChildProcessByStdio<null, Readable, Readable> | null;
  pid: number | null;
  port: number;
  state: ServiceStatus["state"];
  restarts: number;
  lastError: string | null;
  stopping: boolean;
  /** 正在 spawn + 等待健康检查；此时退出由 startService 重试，不进入退避重启 */
  starting: boolean;
  restartTimer: NodeJS.Timeout | null;
  lines: string[];
}

export interface SupervisorOptions {
  workspace: string;
  appPort: number;
  runnerPort: number;
  sourceRoot: string;
  /** 生产布局（resources/ 下的 next / runner / node） */
  packaged: boolean;
  resources: {
    nextRoot: string;
    nextServer: string;
    runnerServer: string;
    nodeExe: string;
  };
  onStatus: (statuses: ServiceStatus[]) => void;
  /** runner 非预期退出（用于落盘 interrupted + 通知） */
  onRunnerCrash: (code: number | null) => void;
}

export class Supervisor {
  private readonly token = crypto.randomBytes(32).toString("hex");
  /** 标识本次拉起的 Next 实例；健康检查要求响应中的 instance 与之一致 */
  private readonly instance = crypto.randomBytes(8).toString("hex");
  private stopping = false;
  private next: Managed;
  private runner: Managed;
  private readonly options: SupervisorOptions;

  constructor(options: SupervisorOptions) {
    this.options = options;
    this.next = {
      name: "next",
      child: null,
      pid: null,
      port: options.appPort,
      state: "stopped",
      restarts: 0,
      lastError: null,
      stopping: false,
      starting: false,
      restartTimer: null,
      lines: [],
    };
    this.runner = {
      name: "runner",
      child: null,
      pid: null,
      port: options.runnerPort,
      state: "stopped",
      restarts: 0,
      lastError: null,
      stopping: false,
      starting: false,
      restartTimer: null,
      lines: [],
    };
  }

  get appPort(): number {
    return this.next.port;
  }

  get runnerPort(): number {
    return this.runner.port;
  }

  get runnerToken(): string {
    return this.token;
  }

  status(): ServiceStatus[] {
    return [this.next, this.runner].map((m) => ({
      name: m.name,
      state: m.state,
      pid: m.pid,
      port: m.port,
      restarts: m.restarts,
      lastError: m.lastError,
    }));
  }

  tail(name: ServiceName, count = 40): string {
    const managed = name === "next" ? this.next : this.runner;
    return managed.lines.slice(-count).join("\n");
  }

  async start(): Promise<void> {
    this.stopping = false;
    await this.startService("next");
    await this.startService("runner");
  }

  /** 只重启单个服务（菜单操作） */
  async restart(name: ServiceName): Promise<void> {
    const managed = name === "next" ? this.next : this.runner;
    managed.stopping = true;
    await this.kill(managed, 2_000);
    managed.stopping = false;
    managed.restarts = 0;
    managed.lastError = null;
    await this.startService(name);
    if (name === "next") {
      // runner 的回调地址依赖 Next 端口，一并重启
      this.runner.stopping = true;
      await this.kill(this.runner, 2_000);
      this.runner.stopping = false;
      this.runner.restarts = 0;
      this.runner.lastError = null;
      await this.startService("runner");
    }
  }

  /** 退出时序：/shutdown → 等待 → taskkill /T /F 兜底 */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    for (const managed of [this.next, this.runner]) {
      managed.stopping = true;
      if (managed.restartTimer) {
        clearTimeout(managed.restartTimer);
        managed.restartTimer = null;
      }
    }

    // 1. 优雅关闭 runner（进行中的 run 落盘 interrupted）
    try {
      await fetch(`http://127.0.0.1:${this.runner.port}/shutdown`, {
        method: "POST",
        headers: { "x-internal-token": this.token },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      // runner 可能已经死了
    }
    const graceful = await this.waitExit(this.runner, 5_000);
    if (!graceful) await this.kill(this.runner, 3_000);

    await this.kill(this.next, 3_000);
    this.setStates("stopped");
  }

  private async startService(name: ServiceName): Promise<void> {
    const managed = name === "next" ? this.next : this.runner;
    if (this.stopping || managed.stopping) return;

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const previousPort = managed.port;
      managed.state = managed.restarts > 0 ? "restarting" : "starting";
      managed.lastError = null;
      this.emit();

      const { command, args, cwd, shell } = this.commandFor(name);
      const env = this.buildEnv();

      log.info(`[supervisor] spawn ${name}: ${command} ${args.join(" ")} (cwd=${cwd})`);
      const child = spawn(command, args, {
        cwd,
        env,
        shell,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      managed.child = child;
      managed.pid = child.pid ?? null;
      managed.lines = [];
      managed.starting = true;

      const pipe = (stream: NodeJS.ReadableStream, prefix: string): void => {
        let buffer = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split(/\r?\n/);
          buffer = parts.pop() ?? "";
          for (const line of parts) {
            if (!line.trim()) continue;
            managed.lines.push(line);
            if (managed.lines.length > 200) managed.lines.shift();
            childLog(prefix, line);
          }
        });
      };
      pipe(child.stdout, name);
      pipe(child.stderr, name);

      child.on("error", (err) => {
        managed.lastError = err.message;
        log.error(`[supervisor] ${name} spawn error`, err);
      });

      child.on("exit", (code, signal) => {
        managed.child = null;
        managed.pid = null;
        log.info(`[supervisor] ${name} exited code=${code} signal=${signal}`);
        if (this.stopping || managed.stopping) {
          managed.state = "stopped";
          this.emit();
          return;
        }
        // 启动阶段的退出交给 startService 判断是否换端口重试，
        // 否则会同时触发下面的退避重启，导致 startApp 提前报错。
        if (managed.starting) return;
        if (name === "runner") this.options.onRunnerCrash(code);
        this.handleExit(managed, code);
      });

      try {
        await this.waitReady(name, managed);
        managed.starting = false;
        managed.state = "running";
        this.emit();

        // Next 换了端口后 runner 的回调地址失效，需要一并重启
        if (
          name === "next" &&
          managed.port !== previousPort &&
          this.runner.child &&
          !this.runner.starting
        ) {
          await this.restart("runner");
        }
        return;
      } catch (e) {
        managed.starting = false;
        const message = e instanceof Error ? e.message : String(e);
        const addressInUse = /EADDRINUSE/i.test(managed.lines.join("\n"));

        if (addressInUse && attempt < maxAttempts - 1 && !this.stopping) {
          // 健康检查超时（而非退出）时子进程可能还活着，先清掉再换端口
          if (managed.child) await this.kill(managed, 2_000);
          managed.port = await pickPort(name === "next" ? this.runner.port : this.next.port);
          log.warn(
            `[supervisor] ${name} EADDRINUSE，改用端口 ${managed.port} 重试（${attempt + 1}/${maxAttempts}）`
          );
          continue;
        }

        managed.lastError = message;
        log.error(`[supervisor] ${name} not ready`, managed.lastError);
        managed.state = "failed";
        this.emit();
        throw e;
      }
    }
  }

  private commandFor(name: ServiceName): {
    command: string;
    args: string[];
    cwd: string;
    shell: boolean;
  } {
    const { packaged, resources, sourceRoot } = this.options;
    const xqDir = path.join(sourceRoot, "xiaoqian-manager");

    if (name === "next") {
      if (packaged) {
        return {
          command: resources.nodeExe,
          args: [resources.nextServer],
          cwd: resources.nextRoot,
          shell: false,
        };
      }
      return {
        command: "yarn",
        args: ["next", "dev", "-p", String(this.next.port), "-H", "127.0.0.1"],
        cwd: xqDir,
        shell: isWin,
      };
    }

    if (packaged) {
      return {
        command: resources.nodeExe,
        args: [resources.runnerServer],
        cwd: this.options.workspace,
        shell: false,
      };
    }
    return {
      command: "yarn",
      args: ["runner"],
      cwd: xqDir,
      shell: isWin,
    };
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const workspace = this.options.workspace;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: enrichedPath(),
      FEBOT_WORKSPACE: workspace,
      FEBOT_ROOT: workspace,
      FEBOT_CONFIG: workspaceConfigFile(workspace),
      FEBOT_DESKTOP: "1",
      FEBOT_DESKTOP_INSTANCE: this.instance,
      PORT: String(this.next.port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      XQ_RUNNER_PORT: String(this.runner.port),
      XQ_RUNNER_TOKEN: this.token,
      XQ_APP_URL: `http://127.0.0.1:${this.next.port}`,
      XQ_RUN_TIMEOUT_MS: process.env.XQ_RUN_TIMEOUT_MS ?? String(6 * 60 * 60 * 1000),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  }

  private async waitReady(name: ServiceName, managed: Managed): Promise<void> {
    if (name === "next") {
      // 不能只看 HTTP 200：端口被别的 Next 占用时也会 200（且 /api/runner/info
      // 可能来自另一个实例）。要求 identity 返回本次启动注入的随机 instance。
      const expected = this.instance;
      await waitForHttp(
        `http://127.0.0.1:${managed.port}/api/desktop/identity`,
        NEXT_READY_TIMEOUT_MS,
        () => managed.child === null,
        (body) => readJsonField(body, "instance") === expected
      );
    } else {
      // runner 同理：/healthz 的 pid 必须是我们拉起的进程。
      const expectedPid = managed.pid;
      await waitForHttp(
        `http://127.0.0.1:${managed.port}/healthz`,
        RUNNER_READY_TIMEOUT_MS,
        () => managed.child === null,
        (body) => readJsonField(body, "pid") === expectedPid
      );
    }
  }

  private waitExit(managed: Managed, timeoutMs: number): Promise<boolean> {
    if (!managed.child) return Promise.resolve(true);
    const child = managed.child;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private async kill(managed: Managed, timeoutMs: number): Promise<void> {
    if (!managed.child || !managed.pid) return;
    const pid = managed.pid;
    try {
      if (isWin) {
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        managed.child.kill("SIGTERM");
      }
    } catch (e) {
      log.warn(`[supervisor] kill ${managed.name} failed`, e);
    }
    const exited = await this.waitExit(managed, timeoutMs);
    if (!exited) {
      try {
        managed.child?.kill();
      } catch {
        // ignore
      }
    }
  }

  private handleExit(managed: Managed, code: number | null): void {
    const tail = managed.lines.slice(-30).join("\n");
    const addressInUse = /EADDRINUSE/i.test(tail);

    if (addressInUse) {
      // 端口被抢占：换端口并重启（不计入退避次数）
      void (async () => {
        try {
          const ports = await allocatePorts(null, null);
          managed.port = managed.name === "next" ? ports.appPort : ports.runnerPort;
          log.warn(`[supervisor] ${managed.name} EADDRINUSE，改用端口 ${managed.port}`);
          managed.state = "restarting";
          this.emit();
          managed.restartTimer = setTimeout(() => {
            managed.restartTimer = null;
            void this.startService(managed.name).catch((e) =>
              log.error(`[supervisor] restart ${managed.name} failed`, e)
            );
            if (managed.name === "next") {
              // runner 的回调地址依赖 Next 端口
              void this.restart("runner").catch(() => undefined);
            }
          }, 500);
        } catch (e) {
          managed.state = "failed";
          managed.lastError = e instanceof Error ? e.message : String(e);
          this.emit();
        }
      })();
      return;
    }

    managed.restarts += 1;
    if (managed.restarts > RESTART_DELAYS_MS.length) {
      managed.state = "failed";
      managed.lastError = `连续退出 ${managed.restarts} 次，已停止自动重启（exit=${code}）`;
      this.emit();
      return;
    }
    const delay = RESTART_DELAYS_MS[managed.restarts - 1];
    managed.state = "restarting";
    managed.lastError = `服务异常退出（exit=${code}），${Math.round(delay / 1000)}s 后重启`;
    this.emit();
    managed.restartTimer = setTimeout(() => {
      managed.restartTimer = null;
      void this.startService(managed.name).catch((e) =>
        log.error(`[supervisor] restart ${managed.name} failed`, e)
      );
    }, delay);
  }

  private emit(): void {
    try {
      this.options.onStatus(this.status());
    } catch (e) {
      log.error("[supervisor] onStatus callback failed", e);
    }
  }

  private setStates(state: ServiceStatus["state"]): void {
    this.next.state = state;
    this.runner.state = state;
    this.emit();
  }
}

/** 分配一个与 avoid 不同的临时端口 */
async function pickPort(avoid: number): Promise<number> {
  for (let i = 0; i < 10; i += 1) {
    const port = await findFreePort(0);
    if (port !== avoid && port > 0) return port;
  }
  throw new Error("无法分配空闲端口（与另一服务端口冲突）");
}

async function waitForHttp(
  url: string,
  timeoutMs: number,
  aborted: () => boolean,
  validate?: (body: string) => boolean
): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    if (aborted()) throw new Error(`进程已退出，服务未就绪：${url}`);
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
      if (res.ok) {
        if (!validate) return;
        const body = await res.text();
        if (validate(body)) return;
        lastError = "响应来自其他实例（身份不匹配）";
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`等待服务就绪超时（${timeoutMs}ms）：${url}（${lastError}）`);
}

function readJsonField(body: string, field: string): unknown {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return parsed[field];
  } catch {
    return undefined;
  }
}