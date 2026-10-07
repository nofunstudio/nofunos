import { describe, expect, it } from "vite-plus/test";

import { parseGuestMessage, supportsWarpV2, withProtocol } from "./protocol.ts";

describe("guest feature detection", () => {
  it("treats a ready without protocols as a v1 guest", () => {
    const ready = parseGuestMessage({ protocol: "nofun-warp/1", type: "ready" });
    expect(ready).toEqual({ type: "ready", protocols: [], wireProtocol: "nofun-warp/1" });
    expect(supportsWarpV2(ready?.type === "ready" ? ready.protocols : [])).toBe(false);
  });

  it("detects v2 from ready.protocols and answers with the guest's own wire protocol", () => {
    const ready = parseGuestMessage({
      protocol: "nofun-warp/2",
      type: "ready",
      protocols: ["nofun-warp/1", "nofun-warp/2"],
    });
    if (ready?.type !== "ready") throw new Error("expected ready");
    expect(supportsWarpV2(ready.protocols)).toBe(true);
    expect(withProtocol({ type: "focus" }, ready.wireProtocol).protocol).toBe("nofun-warp/2");
  });

  it("parses pane lifecycle messages and drops malformed or foreign ones", () => {
    expect(
      parseGuestMessage({
        protocol: "nofun-warp/2",
        type: "paneOpened",
        requestId: "r",
        paneId: "p",
      }),
    ).toEqual({ type: "paneOpened", requestId: "r", paneId: "p" });
    expect(
      parseGuestMessage({
        protocol: "nofun-warp/2",
        type: "paneClosed",
        paneId: "p",
        terminalId: null,
      }),
    ).toEqual({ type: "paneClosed", paneId: "p", terminalId: null });
    expect(
      parseGuestMessage({ protocol: "nofun-warp/2", type: "paneOpened", paneId: "p" }),
    ).toBeNull();
    expect(parseGuestMessage({ protocol: "other/1", type: "ready" })).toBeNull();
  });
});
