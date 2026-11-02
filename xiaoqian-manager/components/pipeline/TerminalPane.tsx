"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";

// xterm 封装：只负责渲染与输入，不持有 WS。
// 会话页把 output 事件写进来，把 onData / onResize 转发给 runner。
// xterm 在 effect 内动态 import，避免 SSR 阶段触碰 DOM。

export interface TerminalApi {
  write: (data: string) => void;
  reset: () => void;
  focus: () => void;
}

export default function TerminalPane({
  onData,
  onResize,
  onReady,
}: {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: (api: TerminalApi) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const dataRef = useRef(onData);
  const resizeRef = useRef(onResize);
  // 回调写 ref 只在渲染提交后同步，避免在 render 期间改 ref（React 19 lint）
  useEffect(() => {
    dataRef.current = onData;
  }, [onData]);
  useEffect(() => {
    resizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const [{ Terminal }, { FitAddon }, { Unicode11Addon }, { WebglAddon }] =
        await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-unicode11"),
          import("@xterm/addon-webgl"),
        ]);
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        fontSize: 13,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Consolas, "Microsoft YaHei", monospace',
        scrollback: 8000,
        allowProposedApi: true,
        theme: {
          background: "#0f1115",
          foreground: "#e6edf3",
          cursor: "#7aa2f7",
          selectionBackground: "#334155",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);

      // 中文/emoji 宽字符按 Unicode 11 计算。默认 V6 表把很多宽字符当 1 格，
      // 会让 TUI 的边框、光标和输入锚点整体错位
      try {
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = "11";
      } catch {
        // 退回默认 Unicode V6 宽度
      }

      // WebGL 渲染器：TUI 整屏重绘明显更快；上下文丢失时自动回落 DOM 渲染器
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // 不支持 WebGL2，保留默认 DOM 渲染器
      }

      try {
        fit.fit();
      } catch {
        // 容器尚未有尺寸
      }
      termRef.current = term;
      fitRef.current = fit;

      let lastCols = -1;
      let lastRows = -1;
      let raf = 0;
      const emitResize = () => {
        try {
          fit.fit();
        } catch {
          // ignore
        }
        // 只有行列真的变了才回调：避免无谓的 PTY resize 触发 TUI 整屏重绘
        if (term.cols === lastCols && term.rows === lastRows) return;
        lastCols = term.cols;
        lastRows = term.rows;
        resizeRef.current(term.cols, term.rows);
      };
      // 同一帧内的多次 ResizeObserver 回调合并成一次 fit
      const scheduleResize = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (disposed) return;
          emitResize();
        });
      };
      emitResize();

      // 字体加载完成后字宽会变，必须重新 fit：否则算出的 cols/rows 偏大，
      // 内容溢出 + 光标/输入锚点错位
      if (typeof document !== "undefined" && document.fonts) {
        void document.fonts.ready.then(() => {
          if (!disposed) scheduleResize();
        });
      }

      const sub = term.onData((data) => dataRef.current(data));
      const ro = new ResizeObserver(() => scheduleResize());
      ro.observe(hostRef.current);
      term.focus();

      onReady({
        write: (data: string) => {
          try {
            term.write(data);
          } catch {
            // ignore
          }
        },
        reset: () => {
          try {
            term.reset();
          } catch {
            // ignore
          }
        },
        focus: () => term.focus(),
      });

      cleanup = () => {
        if (raf) cancelAnimationFrame(raf);
        sub.dispose();
        ro.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // onReady 只用于交出 API，生命周期与组件一致
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-lg bg-[#0f1115]">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
