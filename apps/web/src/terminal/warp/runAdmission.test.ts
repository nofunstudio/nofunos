import { describe, expect, it } from "vite-plus/test";

import { createRunAdmission } from "./runAdmission.ts";

const TARGET = { paneId: "pane-1", terminalId: "warp-aaaa" };
const connected = { terminalId: "warp-aaaa", state: "connected" as const };

describe("warp run admission", () => {
  it("admits one submission per action and refuses a double click while it is unanswered", () => {
    const admission = createRunAdmission();
    expect(admission.admit("a1", TARGET, connected)).toEqual({ ok: true });
    expect(admission.admit("a1", TARGET, connected)).toEqual({
      ok: false,
      reason: "duplicate_action",
    });
    // A different click on the same pane is also refused until the first settles.
    expect(admission.admit("a2", TARGET, connected)).toEqual({ ok: false, reason: "in_flight" });
    admission.settle("a1", "acknowledged");
    expect(admission.admit("a2", TARGET, connected)).toEqual({ ok: true });
  });

  it("refuses a stale or unconnected target before anything is sent", () => {
    const admission = createRunAdmission();
    expect(admission.admit("a1", TARGET, undefined)).toEqual({
      ok: false,
      reason: "stale_target",
    });
    expect(admission.admit("a1", TARGET, { terminalId: "warp-bbbb", state: "connected" })).toEqual({
      ok: false,
      reason: "stale_target",
    });
    expect(admission.admit("a1", TARGET, { terminalId: "warp-aaaa", state: "exited" })).toEqual({
      ok: false,
      reason: "not_connected",
    });
  });

  it("never admits an action whose acknowledgement was lost a second time", () => {
    const admission = createRunAdmission();
    expect(admission.admit("a1", TARGET, connected)).toEqual({ ok: true });
    admission.settle("a1", "unknown");
    expect(admission.admit("a1", TARGET, connected)).toEqual({
      ok: false,
      reason: "duplicate_action",
    });
  });
});
