import { describe, expect, it } from "vite-plus/test";

import {
  museRow,
  resolveEffort,
  shortModelName,
  splitFleetRows,
  subagentRow,
  type MuseJobSummary,
} from "./fleetModel";

const agent = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "node-1",
    origin: "app_owned",
    driver: "claudeAgent",
    title: null,
    prompt: "reply OK",
    model: null,
    status: "running",
    childThreadId: "thread-child",
    ...overrides,
  }) as never;

const base = (overrides: Record<string, unknown> = {}) =>
  subagentRow({
    agent: agent(overrides),
    displayTitle: "Check it",
    childSelection: undefined,
    tokens: null,
    depth: 0,
    startedAt: "2026-10-06T10:00:00.000Z",
    completedAt: null,
  });

describe("subagentRow", () => {
  it("labels app-owned children as from T3 and provider ones as native", () => {
    expect(base().origin).toBe("From T3");
    expect(base({ origin: "provider_native", driver: "codex" }).origin).toBe("Codex native");
    expect(base({ origin: "provider_native" }).source).toBe("native");
  });

  it("falls back to the child selection's model and reads effort from provider options", () => {
    const row = subagentRow({
      agent: agent(),
      displayTitle: "x",
      childSelection: {
        instanceId: "claude",
        model: "claude-haiku-4-5",
        options: [{ id: "effort", value: "high" }],
      } as never,
      tokens: 1200,
      depth: 1,
      startedAt: null,
      completedAt: null,
    });
    expect(row.model).toBe("claude-haiku-4-5");
    expect(row.effort).toBe("high");
    expect(row.tokens).toBe(1200);
    expect(row.depth).toBe(1);
  });

  it("prefers the model the agent reported over the selection", () => {
    expect(base({ model: "gpt-6-luna" }).model).toBe("gpt-6-luna");
  });

  it("maps statuses to phases and activity", () => {
    expect(base({ status: "pending" })).toMatchObject({ phase: "queued", active: true });
    expect(base({ status: "waiting" })).toMatchObject({ phase: "waiting", active: true });
    expect(base({ status: "idle" })).toMatchObject({ phase: "done", active: false });
    expect(base({ status: "interrupted" })).toMatchObject({ phase: "stopped", active: false });
    expect(base({ status: "failed" })).toMatchObject({ phase: "failed", active: false });
  });
});

describe("resolveEffort", () => {
  it("is null without a selection or option", () => {
    expect(resolveEffort(undefined)).toBeNull();
    expect(resolveEffort({ instanceId: "x", model: "m" } as never)).toBeNull();
  });
});

describe("museRow", () => {
  const job = (status: MuseJobSummary["status"]): MuseJobSummary => ({
    jobId: "muse-1",
    status,
    profile: "muse-review",
    model: "muse-spark-1.3-contributor",
    startedAt: "2026-10-06T10:00:00.000Z",
    finishedAt: null,
    note: null,
  });

  it("is an external worker with no reported tokens", () => {
    expect(museRow(job("running"))).toMatchObject({
      source: "muse",
      origin: "External worker",
      title: "Muse review",
      tokens: null,
      active: true,
      museJobId: "muse-1",
    });
    expect(museRow(job("succeeded")).active).toBe(false);
    expect(museRow(job("cancelled")).phase).toBe("stopped");
  });
});

describe("splitFleetRows", () => {
  it("keeps active rows in order and sorts settled newest first", () => {
    const rows = [
      { ...base(), key: "a", active: true },
      { ...base({ status: "completed" }), key: "b", completedAt: "2026-10-06T10:01:00.000Z" },
      { ...base({ status: "completed" }), key: "c", completedAt: "2026-10-06T10:05:00.000Z" },
    ];
    const { active, settled } = splitFleetRows(rows);
    expect(active.map((row) => row.key)).toEqual(["a"]);
    expect(settled.map((row) => row.key)).toEqual(["c", "b"]);
  });
});

describe("shortModelName", () => {
  it("drops a trailing date and keeps null", () => {
    expect(shortModelName("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(shortModelName(null)).toBeNull();
  });
});
