/**
 * Pure pieces of Muse subscription usage: the accounts file, the `usage/changed`
 * payload `muse serve` emits, and the pick of which subscription runs the next
 * Muse job. The service in `MuseUsage.ts` owns the processes and the cache.
 */
import {
  ProviderDriverKind,
  type ServerProviderUsageWindow,
  type UsageLimitSourceId,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const isoFromMs = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

/** One Muse subscription. `authPath` is the login `muse login` wrote with `MUSE_AUTH_PATH`. */
export const MuseAccount = Schema.Struct({
  /** Shown in the usage views and used as the cache key, e.g. `Muse 2`. */
  label: Schema.String.check(Schema.isMinLength(1)),
  /** Omitted for the default login (`~/.config/muse/auth.json`). */
  authPath: Schema.optional(Schema.String),
});
export type MuseAccount = typeof MuseAccount.Type;

/**
 * `~/.nofun-t3/muse-accounts.json`. Only the server whose persona matches
 * `persona` reads usage, so one Muse login is probed by one environment.
 */
export const MuseAccountsFile = Schema.Struct({
  persona: Schema.String,
  accounts: Schema.Array(MuseAccount),
});
export type MuseAccountsFile = typeof MuseAccountsFile.Type;

/** What a missing or unreadable accounts file means: Muse usage is off. */
export const NO_MUSE_ACCOUNTS: MuseAccountsFile = { persona: "", accounts: [] };

const UsageBlock = Schema.Struct({
  usedPercent: Schema.Number,
  resetsAtMs: Schema.Number,
  windowDurationMins: Schema.optional(Schema.Number),
});

/** The MSP `SubscriptionUsage` payload of `usage/changed` and `usage/read`. */
export const MuseSubscriptionUsage = Schema.Struct({
  window: UsageBlock,
  weekly: UsageBlock,
  tier: Schema.optional(Schema.String),
  observedAtMs: Schema.Number,
});
export type MuseSubscriptionUsage = typeof MuseSubscriptionUsage.Type;

/** Muse reports over-quota values above 100; the wire contract caps at 100. */
const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export function museUsageWindows(
  usage: MuseSubscriptionUsage,
): ReadonlyArray<ServerProviderUsageWindow> {
  return [
    {
      id: "five_hour",
      kind: "session",
      label: "5-hour",
      usedPercent: clampPercent(usage.window.usedPercent),
      resetsAt: isoFromMs(usage.window.resetsAtMs),
      ...(usage.window.windowDurationMins
        ? { windowDurationMins: Math.round(usage.window.windowDurationMins) }
        : {}),
    },
    {
      id: "weekly",
      kind: "weekly",
      label: "Weekly",
      usedPercent: clampPercent(usage.weekly.usedPercent),
      resetsAt: isoFromMs(usage.weekly.resetsAtMs),
      windowDurationMins: 7 * 24 * 60,
    },
  ];
}

export interface MuseAccountState {
  readonly account: MuseAccount;
  readonly usage: MuseSubscriptionUsage | null;
  readonly error: string | null;
  /** When the last probe finished, successful or not, epoch ms. */
  readonly checkedAtMs: number | null;
}

/** One usage-limit source per subscription, so each keeps its own error row. */
export function museSourceSnapshot(state: MuseAccountState): UsageLimitSourceSnapshot {
  const checkedAt = isoFromMs(state.usage?.observedAtMs ?? state.checkedAtMs ?? 0);
  const base = {
    id: `muse:${state.account.label}` as UsageLimitSourceId,
    kind: "muse" as const,
    label: state.account.label,
    checkedAt,
  };
  if (!state.usage) {
    return { ...base, accounts: [], error: state.error ?? "Not read yet." };
  }
  return {
    ...base,
    accounts: [
      {
        id: state.account.label,
        driver: ProviderDriverKind.make("muse"),
        usageLimits: { checkedAt, windows: museUsageWindows(state.usage) },
      },
    ],
    ...(state.error ? { error: state.error } : {}),
  };
}

export type MusePick =
  | { readonly _tag: "Account"; readonly account: MuseAccount }
  | { readonly _tag: "AllLimited"; readonly resetsAtMs: number };

/**
 * The subscription with the most five-hour room that is not out of weekly
 * quota. Accounts never read successfully rank last but still run, so a
 * failing probe never blocks work. When every read account is spent, the
 * caller should route the work elsewhere until the earliest reset.
 */
export function pickMuseAccount(states: ReadonlyArray<MuseAccountState>): MusePick | null {
  const known = states.filter((state) => state.usage !== null);
  const open = known.filter(
    (state) => state.usage!.window.usedPercent < 100 && state.usage!.weekly.usedPercent < 100,
  );
  const best = open.toSorted(
    (a, b) => a.usage!.window.usedPercent - b.usage!.window.usedPercent,
  )[0];
  if (best) return { _tag: "Account", account: best.account };
  const unknown = states.find((state) => state.usage === null);
  if (unknown) return { _tag: "Account", account: unknown.account };
  if (known.length === 0) return null;
  const resetsAtMs = Math.min(
    ...known.map((state) =>
      state.usage!.weekly.usedPercent >= 100
        ? state.usage!.weekly.resetsAtMs
        : state.usage!.window.resetsAtMs,
    ),
  );
  return { _tag: "AllLimited", resetsAtMs };
}
