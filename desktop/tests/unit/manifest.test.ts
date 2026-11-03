import { describe, expect, it } from "vitest";
import { decideSyncAction } from "../../src/main/manifest";

describe("decideSyncAction", () => {
  it("复制工作区缺失的文件", () => {
    expect(decideSyncAction({ currentSha: null, oldSha: null, newSha: "n" })).toBe("copy");
  });

  it("已是最新则跳过", () => {
    expect(decideSyncAction({ currentSha: "n", oldSha: "o", newSha: "n" })).toBe("skip");
  });

  it("用户未改过则覆盖", () => {
    expect(decideSyncAction({ currentSha: "o", oldSha: "o", newSha: "n" })).toBe("overwrite");
  });

  it("用户改过则冲突，不覆盖", () => {
    expect(decideSyncAction({ currentSha: "u", oldSha: "o", newSha: "n" })).toBe("conflict");
  });

  it("无基线且文件已存在视为冲突", () => {
    expect(decideSyncAction({ currentSha: "u", oldSha: null, newSha: "n" })).toBe("conflict");
  });
});