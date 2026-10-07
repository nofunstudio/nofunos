import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import { teamUsageRows } from "./TeamUsage.logic";

function window(
  id: string,
  kind: ServerProviderUsageWindow["kind"],
  label: string,
): ServerProviderUsageWindow {
  return { id, kind, label, usedPercent: 40 };
}

function account(key: string, driver: string, windows: ServerProviderUsageWindow[]): LimitAccount {
  return {
    key,
    driver: driver as LimitAccount["driver"],
    displayName: key,
    email: undefined,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: { checkedAt: "2026-10-07T00:00:00.000Z", windows },
  };
}

const claudeWindows = [
  window("seven_day_opus", "weekly", "Weekly · Opus"),
  window("five_hour", "session", "Session"),
  window("seven_day", "weekly", "Weekly"),
];

describe("teamUsageRows", () => {
  it("lists Claude before Codex and numbers a second Claude account", () => {
    const rows = teamUsageRows([
      account("codex", "codex", [window("primary", "session", "Session")]),
      account("claude-a", "claudeAgent", claudeWindows),
      account("claude-b", "claudeAgent", claudeWindows),
    ]);
    expect(rows.map((row) => [row.account.key, row.ordinal])).toEqual([
      ["claude-a", null],
      ["claude-b", 2],
      ["codex", null],
    ]);
  });

  it("picks the five-hour window and the overall weekly one", () => {
    const [row] = teamUsageRows([account("claude", "claudeAgent", claudeWindows)]);
    expect(row?.session?.id).toBe("five_hour");
    expect(row?.weekly?.id).toBe("seven_day");
  });

  it("drops accounts with neither window", () => {
    expect(teamUsageRows([account("x", "codex", [])])).toEqual([]);
  });
});
