// 首期无登录：设置写接口只允许本机同源请求。
// - Host 必须是 localhost / 127.0.0.1 / ::1
// - 若带 Origin，Origin 的 host 必须与 Host 一致
// 用户显式把服务暴露到局域网时，写接口返回明确提示。

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  return h.split(":")[0];
}

export interface GuardResult {
  ok: boolean;
  message: string;
}

export function guardLocalWrite(req: Request): GuardResult {
  const host = req.headers.get("host") ?? "";
  if (!host) {
    return { ok: false, message: "缺少 Host 头，拒绝写入配置" };
  }
  const hostname = hostnameOf(host);
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return {
      ok: false,
      message: "当前为本地模式，请在本机（localhost）操作；登录/远程管理将在后续版本开放",
    };
  }
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (originHost !== host.toLowerCase()) {
        return { ok: false, message: "跨站写入被拒绝" };
      }
    } catch {
      return { ok: false, message: "Origin 不合法，拒绝写入配置" };
    }
  }
  return { ok: true, message: "" };
}