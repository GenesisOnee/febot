import type { DoctorReport, SetupMode, WorkspaceCheck } from "../../shared/types";

const api = window.febotDesktop;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const workspaceInput = $<HTMLInputElement>("workspace");
const browseBtn = $<HTMLButtonElement>("browse");
const checkBtn = $<HTMLButtonElement>("check");
const doctorBtn = $<HTMLButtonElement>("doctor");
const finishBtn = $<HTMLButtonElement>("finish");
const checkResult = $<HTMLDivElement>("checkResult");
const doctorResult = $<HTMLUListElement>("doctorResult");
const statusEl = $<HTMLDivElement>("status");
const repoRootInput = $<HTMLInputElement>("repoRoot");
const reposInput = $<HTMLInputElement>("repos");
const branchInput = $<HTMLInputElement>("branch");

function currentMode(): SetupMode {
  const checked = document.querySelector<HTMLInputElement>('input[name="mode"]:checked');
  return checked?.value === "takeover" ? "takeover" : "new";
}

function setStatus(message: string, kind: "normal" | "error" = "normal"): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", kind === "error");
}

function setBusy(busy: boolean): void {
  for (const button of [browseBtn, checkBtn, doctorBtn, finishBtn]) button.disabled = busy;
}

function renderCheck(result: WorkspaceCheck): void {
  checkResult.classList.remove("hidden", "ok", "warn", "error");
  const lines: string[] = [];
  if (result.errors.length) lines.push(...result.errors.map((e) => `错误：${e}`));
  if (result.warnings.length) lines.push(...result.warnings.map((w) => `提示：${w}`));
  if (!lines.length) lines.push("校验通过");
  checkResult.classList.add(result.errors.length ? "error" : result.warnings.length ? "warn" : "ok");
  checkResult.innerHTML = `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
}

function renderDoctor(report: DoctorReport): void {
  doctorResult.innerHTML = report.items
    .map((item) => {
      const cls = item.ok ? "ok" : item.required ? "bad" : "opt";
      const badge = item.ok ? "✓" : item.required ? "✗" : "–";
      const tag = item.required ? "" : "（可选）";
      const fix = !item.ok && item.fix ? `<small>${escapeHtml(item.fix)}</small>` : "";
      return `<li class="${cls}"><span class="badge">${badge}</span><span>${escapeHtml(
        item.label
      )}${tag}：${escapeHtml(item.detail)}${fix}</span></li>`;
    })
    .join("");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

function configInput(): { repoRoot?: string; repos?: string[]; defaultBranch?: string } {
  const repos = reposInput.value
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    repoRoot: repoRootInput.value.trim() || undefined,
    repos: repos.length ? repos : undefined,
    defaultBranch: branchInput.value.trim() || undefined,
  };
}

async function initialize(): Promise<void> {
  const settings = await api.getSettings();
  if (settings.workspace) workspaceInput.value = settings.workspace;
  const radio = document.querySelector<HTMLInputElement>(
    `input[name="mode"][value="${settings.workspaceMode}"]`
  );
  if (radio) radio.checked = true;
  setStatus("准备就绪");
}

browseBtn.addEventListener("click", async () => {
  const picked = await api.pickWorkspace();
  if (picked) workspaceInput.value = picked;
});

checkBtn.addEventListener("click", async () => {
  const dir = workspaceInput.value.trim();
  if (!dir) {
    setStatus("请先选择工作区目录", "error");
    return;
  }
  setStatus("校验中…");
  try {
    const result = await api.validateWorkspace(dir, currentMode());
    renderCheck(result);
    setStatus(result.ok ? "工作区校验通过" : "工作区校验未通过", result.ok ? "normal" : "error");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), "error");
  }
});

doctorBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("环境自检中…");
  try {
    const report = await api.runDoctor();
    renderDoctor(report);
    setStatus(report.ok ? "硬依赖齐全" : "存在缺失的硬依赖，请先修复", report.ok ? "normal" : "error");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), "error");
  } finally {
    setBusy(false);
  }
});

finishBtn.addEventListener("click", async () => {
  const workspace = workspaceInput.value.trim();
  if (!workspace) {
    setStatus("请先选择工作区目录", "error");
    return;
  }
  setBusy(true);
  setStatus("正在校验工作区…");
  try {
    const mode = currentMode();
    const check = await api.validateWorkspace(workspace, mode);
    if (!check.ok) {
      renderCheck(check);
      throw new Error(check.errors.join("；"));
    }
    const result = await api.finishSetup({ mode, workspace, config: configInput() });
    if (result.conflicts.length) {
      setStatus(
        `已启动；${result.conflicts.length} 个运行时文件存在用户改动，已生成 .febot-new`,
        "normal"
      );
    } else {
      setStatus("启动完成");
    }
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), "error");
    setBusy(false);
  }
});

api.onSetupProgress((message) => setStatus(message));

void initialize();