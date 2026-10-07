import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { deriveBackgroundRows } from "./backgroundModel";

const at = (iso: string) => DateTime.makeUnsafe(iso);

function projection(items: ReadonlyArray<Record<string, unknown>>) {
  return {
    runs: [{ id: "run-1", ordinal: 1, status: "completed" }],
    providerThreads: [],
    providerSessions: [],
    turnItems: items,
    thread: { providerInstanceId: "codex", activeProviderThreadId: null, pullRequests: [] },
  } as never;
}

const command = (overrides: Record<string, unknown>) => ({
  id: "item-1",
  type: "command_execution",
  status: "running",
  title: null,
  runId: "run-1",
  nativeItemRef: null,
  input: "pnpm dev",
  output: "ready\nlistening on 3000",
  startedAt: at("2026-10-07T10:00:00Z"),
  updatedAt: at("2026-10-07T10:01:00Z"),
  ...overrides,
});

describe("deriveBackgroundRows", () => {
  it("lists a settled thread's running command with its output and marks it quiet after a while", () => {
    const now = Date.parse("2026-10-07T10:02:00Z");
    const [fresh] = deriveBackgroundRows(projection([command({})]), now);
    expect(fresh).toMatchObject({ label: "pnpm dev", kind: "command", quiet: false });
    expect(fresh?.output).toEqual(["ready", "listening on 3000"]);
    const [stale] = deriveBackgroundRows(projection([command({})]), now + 10 * 60_000);
    expect(stale?.quiet).toBe(true);
  });

  it("leaves subagents to the agents list and ignores finished commands", () => {
    const rows = deriveBackgroundRows(
      projection([
        command({ id: "a", type: "subagent", input: undefined, prompt: "review" }),
        command({ id: "b", status: "completed" }),
      ]),
      Date.now(),
    );
    expect(rows).toEqual([]);
  });
});
