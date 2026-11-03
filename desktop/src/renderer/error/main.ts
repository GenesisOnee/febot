const api = window.febotDesktop;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const messageEl = $<HTMLPreElement>("message");
const metaEl = $<HTMLDivElement>("meta");
const statusEl = $<HTMLDivElement>("status");
const retryBtn = $<HTMLButtonElement>("retry");
const logsBtn = $<HTMLButtonElement>("logs");
const switchBtn = $<HTMLButtonElement>("switch");

const params = new URLSearchParams(location.search);
messageEl.textContent = params.get("message") || "未知错误";

function setStatus(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

function setBusy(busy: boolean): void {
  for (const button of [retryBtn, logsBtn, switchBtn]) button.disabled = busy;
}

void (async () => {
  try {
    const info = await api.getBootstrap();
    metaEl.textContent = `工作区：${info.workspace || "（未设置）"} · 版本 ${info.version}`;
  } catch {
    // 主进程异常时不阻塞页面
  }
})();

retryBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("正在重启服务…");
  try {
    await api.restartServices();
    setStatus("已发出重启请求");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
    setBusy(false);
  }
});

logsBtn.addEventListener("click", async () => {
  await api.openLogs();
});

switchBtn.addEventListener("click", async () => {
  const picked = await api.pickWorkspace();
  if (!picked) return;
  setBusy(true);
  setStatus("正在切换工作区…");
  try {
    await api.saveSettings({ workspace: picked, workspaceMode: "takeover" });
    await api.restartServices();
    setStatus("已切换工作区并重启服务");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
    setBusy(false);
  }
});