/**
 * Rows for the per-team usage strip at the foot of each sidebar half: one row
 * per subscription account, with its five-hour and weekly windows. Pure so the
 * ordering and window choice are testable without atoms.
 */
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";

export interface TeamUsageRow {
  readonly account: LimitAccount;
  /** 2, 3… for the second and later account of the same provider; null for the first. */
  readonly ordinal: number | null;
  readonly session: ServerProviderUsageWindow | null;
  readonly weekly: ServerProviderUsageWindow | null;
}

const DRIVER_ORDER = ["claudeAgent", "codex"];

/** The overall weekly window, not a per-model one such as `Weekly · Opus`. */
function overallWeekly(windows: readonly ServerProviderUsageWindow[]) {
  const weekly = windows.filter((window) => window.kind === "weekly");
  return weekly.find((window) => !window.label.includes("·")) ?? weekly[0] ?? null;
}

/**
 * Claude accounts, then Codex, then anything else, each in the order the
 * environment lists its instances, so a team's second Claude account keeps its
 * "2" across refreshes.
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
      const session = account.limits.windows.find((window) => window.kind === "session") ?? null;
      const weekly = overallWeekly(account.limits.windows);
      if (!session && !weekly) return [];
      const count = (seen.get(account.driver) ?? 0) + 1;
      seen.set(account.driver, count);
      return [{ account, ordinal: count > 1 ? count : null, session, weekly }];
    });
}
