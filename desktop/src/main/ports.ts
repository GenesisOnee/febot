import net from "node:net";

/**
 * 在通配地址上试监听；成功即返回端口，失败（被占用）回退到系统分配的临时端口。
 *
 * 不能用 127.0.0.1 试：Windows 下 SO_REUSEADDR 允许「0.0.0.0 已占用 + 127.0.0.1
 * 再绑定」同时成功，会误判端口空闲，随后子进程以通配地址启动时 EADDRINUSE。
 * 不指定 host 时 Node 绑定 ::（IPv6 双栈），本机实测可正确探测 IPv4 通配占用。
 */
export function findFreePort(preferred?: number | null): Promise<number> {
  const tryListen = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", reject);
      server.listen(port, () => {
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : 0;
        server.close(() => resolve(actual));
      });
    });

  if (preferred && preferred > 0) {
    // Windows 的 SO_REUSEADDR 允许重新绑定被通配/具体地址占用的端口，
    // 试监听会误报空闲；先实际连一次，能连上就说明有服务在监听。
    return isListening(preferred).then((busy) =>
      busy ? tryListen(0) : tryListen(preferred).catch(() => tryListen(0))
    );
  }
  return tryListen(0);
}

/** 127.0.0.1:port 上是否有服务在监听（连接成功或出现非拒绝错误都算） */
function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    // ECONNREFUSED 才是空闲；其余错误保守当作占用
    socket.once("error", (err: NodeJS.ErrnoException) =>
      finish(err.code !== "ECONNREFUSED" && err.code !== "ECONNRESET")
    );
  });
}

/** 分配两个互不相同的端口。 */
export async function allocatePorts(
  preferredApp?: number | null,
  preferredRunner?: number | null
): Promise<{ appPort: number; runnerPort: number }> {
  const appPort = await findFreePort(preferredApp);
  let runnerPort = await findFreePort(preferredRunner && preferredRunner !== appPort ? preferredRunner : 0);
  if (runnerPort === appPort) runnerPort = await findFreePort(0);
  return { appPort, runnerPort };
}