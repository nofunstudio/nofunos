/**
 * Rows for the per-team usage strip at the foot of each sidebar half: one row
 * per subscription account with its two most useful windows. Pure so the
 * ordering and window choice are testable without atoms.
 */
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";

export interface TeamUsageMeter {
  /** One or two letters beside the bar. */
  readonly short: string;
  /** The window's name in the hover text. */
  readonly name: string;
  readonly window: ServerProviderUsageWindow | null;
}

export interface TeamUsageRow {
  readonly account: LimitAccount;
  /** 2, 3… for the second and later account of the same provider; null for the first. */
  readonly ordinal: number | null;
  readonly meters: readonly [TeamUsageMeter, TeamUsageMeter];
}

const DRIVER_ORDER = ["claudeAgent", "codex", "muse", "cursor"];

/** The overall weekly window, not a per-model one such as `Weekly · Opus`. */
function overallWeekly(windows: readonly ServerProviderUsageWindow[]) {
  const weekly = windows.filter((window) => window.kind === "weekly");
  return weekly.find((window) => !window.label.includes("·")) ?? weekly[0] ?? null;
}

/**
 * Cursor has no five-hour or weekly window: its plan is two monthly pools,
 * one for Cursor's own models and one for every other model.
 */
function metersFor(account: LimitAccount): TeamUsageRow["meters"] {
  const windows = account.limits.windows;
  if (account.driver === "cursor") {
    const byId = (id: string) => windows.find((window) => window.id === id) ?? null;
    return [
      { short: "C", name: "Cursor models", window: byId("autoPercentUsed") },
      { short: "O", name: "Other models", window: byId("apiPercentUsed") },
    ];
  }
  return [
    {
      short: "5h",
      name: "5h",
      window: windows.find((window) => window.kind === "session") ?? null,
    },
    { short: "W", name: "Weekly", window: overallWeekly(windows) },
  ];
}

/**
 * Claude, Codex, Muse, then Cursor, each in the order the environment lists
 * its accounts, so a team's second account of a provider keeps its "2"
 * across refreshes.
 */
export function teamUsageRows(accounts: readonly LimitAccount[]): readonly TeamUsageRow[] {
  const rank = (driver: string) => {
    const index = DRIVER_ORDER.indexOf(driver);
    return index === -1 ? DRIVER_ORDER.length : index;
  };
  const seen = new Map<string, number>();
  return accounts
    .map((account, index) => ({ account, index }))
    .toSorted((a, b) => rank(a.account.driver) - rank(b.account.driver) || a.index - b.index)
    .flatMap(({ account }) => {
      const meters = metersFor(account);
      if (!meters[0].window && !meters[1].window) return [];
      const count = (seen.get(account.driver) ?? 0) + 1;
      seen.set(account.driver, count);
      return [{ account, ordinal: count > 1 ? count : null, meters }];
    });
}
