import { describe, expect, it } from "vite-plus/test";

import { buildWarpTerminalContext } from "./askContext.ts";

describe("buildWarpTerminalContext", () => {
  it("carries the tab's observed cwd and its last command block to the composer", () => {
    const context = buildWarpTerminalContext({
      message: {
        type: "askInT3",
        paneId: "pane-1",
        terminalId: "warp-abc12345",
        command: "pnpm test",
        output: "1 failed\r\n",
        outputTruncated: false,
        cwd: "/work/.wt/shop-feature/apps/web",
        exitCode: 1,
      },
      terminalId: "warp-abc12345",
      sessionLabel: "Shell 2",
      workspaceRoot: "/work/.wt/shop-feature",
    });
    expect(context.terminalLabel).toBe("Warp Shell 2");
    expect(context.text).toContain(
      "Working directory (observed by the shell): /work/.wt/shop-feature/apps/web",
    );
    expect(context.text).toContain("$ pnpm test\n1 failed");
    expect(context.text).toContain("Exit code: 1");
  });

  it("never guesses what the guest did not report", () => {
    const context = buildWarpTerminalContext({
      message: {
        type: "askInT3",
        paneId: "pane-1",
        terminalId: null,
        command: null,
        output: "",
        outputTruncated: false,
        cwd: null,
        exitCode: null,
      },
      terminalId: "warp-abc12345",
      sessionLabel: "Shell 1",
      workspaceRoot: "/work/shop",
    });
    expect(context.text).toContain("observed by the shell): unknown");
    expect(context.text).toContain("Exit code: unknown");
    expect(context.text).toContain("$ (command unknown)");
  });
});
