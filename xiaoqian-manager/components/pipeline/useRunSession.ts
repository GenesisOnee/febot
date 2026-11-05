"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PipelineRun, RunStatus, TimelineEvent } from "@/lib/domain/run";
import type { ClientMessage, RunnerInfo, ServerMessage } from "@/lib/runner/protocol";
import type { TerminalApi } from "./TerminalPane";

// 一个 run 的实时会话：WS 连接/重连/补发、终端输入/resize、状态机。
// 右栏 RunPanel 与整页 SessionView 共用，避免两套 WS 逻辑漂移。

const LIVE_STATUSES: RunStatus[] = ["starting", "running", "needs_input", "settling"];

export function isLiveStatus(status: RunStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

export interface RunSession {
  run: PipelineRun;
  setRun: React.Dispatch<React.SetStateAction<PipelineRun>>;
  events: TimelineEvent[];
  connected: boolean;
  online: boolean;
  notice: string;
  setNotice: (v: string) => void;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  handleReady: (api: TerminalApi) => void;
  termApi: React.RefObject<TerminalApi | null>;
  /** diff 需要刷新的信号 */
  refreshToken: number;
  bumpRefresh: () => void;
}

function eventKey(e: TimelineEvent): string {
  return [e.ts, e.type, e.stage ?? "", e.name ?? "", e.status ?? "", e.path ?? "", e.message ?? ""].join("|");
}

export function useRunSession(initialRun: PipelineRun): RunSession {
  const router = useRouter();
  const runId = initialRun.id;
  const [run, setRun] = useState<PipelineRun>(initialRun);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const termApi = useRef<TerminalApi | null>(null);
  const pendingOutput = useRef("");
  // xterm 还没初始化时收到的屏幕快照：初始化后整屏写入，不能和 pendingOutput 混在一起
  const pendingScreen = useRef<string | null>(null);
  const lastSeq = useRef<number | undefined>(undefined);
  const wsRef = useRef<WebSocket | null>(null);
  const lastStatus = useRef<RunStatus>(initialRun.status);
  // 终端真实尺寸：WS 未连上时也先记住，onopen 后立即补发，避免 PTY 停在启动时的默认尺寸
  const lastSize = useRef<{ cols: number; rows: number } | null>(null);
  const sentSize = useRef<{ cols: number; rows: number } | null>(null);

  const bumpRefresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  // ---------- 首屏时间线 ----------
  useEffect(() => {
    let stopped = false;
    fetch(`/api/runs/${encodeURIComponent(runId)}/events`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { events?: TimelineEvent[] };
        if (!stopped && Array.isArray(json.events)) setEvents(json.events);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [runId]);

  // ---------- WS：连接 / 重连 / 补发 ----------
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const send = (msg: ClientMessage) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const applyMessage = (msg: ServerMessage) => {
      if ("seq" in msg && typeof msg.seq === "number") {
        lastSeq.current = Math.max(lastSeq.current ?? 0, msg.seq);
      }
      switch (msg.type) {
        case "snapshot": {
          setRun(msg.run);
          if (typeof msg.screen === "string") {
            // 服务端影子终端的屏幕快照：整屏替换，不能再叠加原始输出回放
            pendingOutput.current = "";
            const api = termApi.current;
            if (api) {
              api.reset();
              api.write(msg.screen);
            } else {
              pendingScreen.current = msg.screen;
            }
            if (msg.truncated) {
              setNotice("终端输出已超出缓冲上限，只恢复了最近部分内容。");
            }
            return;
          }
          if (msg.truncated) {
            termApi.current?.reset();
            setNotice("终端输出已超出缓冲上限，只恢复了最近部分内容。");
          }
          return;
        }
        case "output": {
          const api = termApi.current;
          if (api) api.write(msg.data);
          else pendingOutput.current += msg.data;
          return;
        }
        case "status": {
          setRun((prev) => ({
            ...prev,
            status: msg.status,
            pid: msg.pid ?? prev.pid,
            changedFiles: msg.changedFiles ?? prev.changedFiles,
          }));
          return;
        }
        case "exit": {
          setRun((prev) => ({ ...prev, exitCode: msg.exitCode }));
          return;
        }
        case "git": {
          setRun((prev) => ({ ...prev, changedFiles: msg.changed }));
          setRefreshToken((n) => n + 1);
          return;
        }
        case "timeline": {
          const e = msg.event;
          setEvents((prev) => {
            const key = eventKey(e);
            if (prev.slice(-50).some((x) => eventKey(x) === key)) return prev;
            return [...prev, e];
          });
          if (e.type === "wait") {
            setRun((prev) => ({
              ...prev,
              status: e.status === "waiting" ? "needs_input" : "running",
            }));
          }
          return;
        }
        case "error": {
          setNotice(msg.message);
          return;
        }
        default:
          return;
      }
    };

    const connect = async () => {
      try {
        const res = await fetch("/api/runner/info", { cache: "no-store" });
        const info = (await res.json()) as RunnerInfo & { online?: boolean };
        if (closed) return;
        if (!info.online || !info.wsUrl || !info.token) {
          setOnline(false);
          setConnected(false);
          retryTimer = setTimeout(connect, 3000);
          return;
        }
        setOnline(true);
        ws = new WebSocket(`${info.wsUrl}?token=${encodeURIComponent(info.token)}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (closed) return;
          attempt = 0;
          setConnected(true);
          const size = lastSize.current;
          if (size) {
            send({ type: "resize", runId, cols: size.cols, rows: size.rows });
            sentSize.current = size;
          }
          send({ type: "attach", runId, lastSeq: lastSeq.current });
          pingTimer = setInterval(() => send({ type: "ping" }), 25_000);
        };
        ws.onmessage = (ev: MessageEvent<string>) => {
          let msg: ServerMessage;
          try {
            msg = JSON.parse(ev.data) as ServerMessage;
          } catch {
            return;
          }
          if (msg.type === "pong") return;
          applyMessage(msg);
        };
        ws.onclose = () => {
          setConnected(false);
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = null;
          if (closed) return;
          const delay = Math.min(10_000, 500 * 2 ** attempt);
          attempt += 1;
          retryTimer = setTimeout(connect, delay);
        };
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            // ignore
          }
        };
      } catch {
        if (closed) return;
        setOnline(false);
        setConnected(false);
        retryTimer = setTimeout(connect, 3000);
      }
    };

    void connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [runId]);

  // 进入终态后刷新一次服务端数据（任务轨迹由 settle 回调写回）
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = run.status;
    if (prev !== run.status && !isLiveStatus(run.status) && isLiveStatus(prev)) {
      router.refresh();
    }
  }, [run.status, router]);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", runId, data } satisfies ClientMessage));
      return;
    }
    // WS 断开时退回 HTTP，输入不丢
    void fetch(`/api/runs/${encodeURIComponent(runId)}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data, submit: false }),
    }).catch(() => undefined);
  }, [runId]);

  const sendResize = useCallback((cols: number, rows: number) => {
    lastSize.current = { cols, rows };
    // 尺寸没变不重复发：无谓的 SIGWINCH 会让 TUI 整屏重绘
    const sent = sentSize.current;
    if (sent && sent.cols === cols && sent.rows === rows) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", runId, cols, rows } satisfies ClientMessage));
      sentSize.current = { cols, rows };
    }
  }, [runId]);

  const handleReady = useCallback((api: TerminalApi) => {
    termApi.current = api;
    const screen = pendingScreen.current;
    if (screen !== null) {
      pendingScreen.current = null;
      pendingOutput.current = "";
      api.reset();
      api.write(screen);
      return;
    }
    if (pendingOutput.current) {
      api.write(pendingOutput.current);
      pendingOutput.current = "";
    }
  }, []);

  return {
    run,
    setRun,
    events,
    connected,
    online,
    notice,
    setNotice,
    sendInput,
    sendResize,
    handleReady,
    termApi,
    refreshToken,
    bumpRefresh,
  };
}