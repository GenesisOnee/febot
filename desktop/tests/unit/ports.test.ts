import net from "node:net";
import { describe, expect, it } from "vitest";
import { allocatePorts, findFreePort } from "../../src/main/ports";

describe("ports", () => {
  it("返回可用的本机端口", async () => {
    const port = await findFreePort(0);
    expect(port).toBeGreaterThan(0);
  });

  it("首选端口被通配地址占用时会换端口", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const occupied = typeof address === "object" && address ? address.port : 0;
    try {
      const port = await findFreePort(occupied);
      expect(port).toBeGreaterThan(0);
      expect(port).not.toBe(occupied);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("首选端口被 127.0.0.1 占用时会换端口（Windows SO_REUSEADDR 场景）", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const occupied = typeof address === "object" && address ? address.port : 0;
    try {
      const port = await findFreePort(occupied);
      expect(port).toBeGreaterThan(0);
      expect(port).not.toBe(occupied);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("分配的 app / runner 端口不同", async () => {
    const { appPort, runnerPort } = await allocatePorts(null, null);
    expect(appPort).toBeGreaterThan(0);
    expect(runnerPort).toBeGreaterThan(0);
    expect(appPort).not.toBe(runnerPort);
  });
});