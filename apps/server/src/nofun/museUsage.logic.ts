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

/**
 * One Muse Code subscription. Each account has its own launchers and its own
 * config and data roots, so sessions and credentials never share a home; the
 * app never switches accounts by rewriting an auth file.
 */
export const MuseAccount = Schema.Struct({
  /** Stable id stored on every job, e.g. `muse-personal`. */
  id: Schema.String.check(Schema.isMinLength(1)),
  /** Shown in the usage views, e.g. `Muse Personal`. */
  label: Schema.String.check(Schema.isMinLength(1)),
  /** The login this account must resolve to; a different one is refused. */
  expectedEmail: Schema.optional(Schema.String),
  /** Plan as the account center names it, when known. */
  plan: Schema.optional(Schema.String),
  /** `muse` CLI or a per-account launcher that pins its own roots. */
  cliExecutable: Schema.optional(Schema.String),
  /** `muse-worker.sh` or a per-account wrapper accepting the same flags. */
  workerExecutable: Schema.optional(Schema.String),
  /** XDG roots for the owned child process; launchers may pin their own. */
  configHome: Schema.optional(Schema.String),
  dataHome: Schema.optional(Schema.String),
});
export type MuseAccount = typeof MuseAccount.Type;

/**
 * The environment for one account's child process, built from the server's.
 * Account-routing variables are removed so the default lane keeps its
 * Keychain login, and a set META_API_KEY refuses the route outright: these
 * accounts run on the subscription and must never fall back to API billing.
 */
export function museChildEnvironment(
  account: MuseAccount,
  parent: Readonly<Record<string, string | undefined>>,
  dataHomeOverride?: string,
): { readonly env: Record<string, string> } | { readonly refused: string } {
  if (parent.META_API_KEY?.trim()) {
    return { refused: "META_API_KEY is set; Muse subscription routes refuse API billing." };
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (key === "MUSE_AUTH_PATH" || key === "TBH_CREDENTIAL_BACKEND" || key === "META_API_KEY")
      continue;
    env[key] = value;
  }
  if (account.configHome) env.XDG_CONFIG_HOME = account.configHome;
  const dataHome = dataHomeOverride ?? account.dataHome;
  if (dataHome) env.XDG_DATA_HOME = dataHome;
  return { env };
}

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
  /** The login `account/read` reported; null until a check succeeds. */
  readonly signedInAs: string | null;
  readonly usage: MuseSubscriptionUsage | null;
  readonly error: string | null;
  /** When the last probe finished, successful or not, epoch ms. */
  readonly checkedAtMs: number | null;
}

/** One usage-limit source per subscription, so each keeps its own error row. */
export function museSourceSnapshot(state: MuseAccountState): UsageLimitSourceSnapshot {
  const checkedAt = isoFromMs(state.usage?.observedAtMs ?? state.checkedAtMs ?? 0);
  const base = {
    id: `muse:${state.account.id}` as UsageLimitSourceId,
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
        ...(state.account.plan ? { plan: state.account.plan } : {}),
        usageLimits: { checkedAt, windows: museUsageWindows(state.usage) },
      },
    ],
    ...(state.error ? { error: state.error } : {}),
  };
}

export type MusePick =
  | { readonly _tag: "Account"; readonly account: MuseAccount }
  | { readonly _tag: "AllLimited"; readonly resetsAtMs: number }
  | { readonly _tag: "Unknown"; readonly id: string };

const isOpen = (state: MuseAccountState) =>
  state.usage === null ||
  (state.usage.window.usedPercent < 100 && state.usage.weekly.usedPercent < 100);

const nextReset = (usage: MuseSubscriptionUsage) =>
  usage.weekly.usedPercent >= 100 ? usage.weekly.resetsAtMs : usage.window.resetsAtMs;

/**
 * Which subscription runs the next Muse job. An explicit `accountId` is
 * honored or refused, never moved to another account. The pool picks the
 * account with the most five-hour room that is not out of weekly quota;
 * accounts never read successfully rank last but still run, so a failing
 * check never blocks work. Accounts signed in as someone else never run.
 * `null` when no account is configured.
 */
export function pickMuseAccount(
  states: ReadonlyArray<MuseAccountState>,
  accountId?: string,
): MusePick | null {
  const eligible = states.filter(
    (state) =>
      !state.account.expectedEmail ||
      state.signedInAs === null ||
      state.signedInAs.toLowerCase() === state.account.expectedEmail.toLowerCase(),
  );
  if (accountId !== undefined) {
    const chosen = eligible.find((state) => state.account.id === accountId);
    if (!chosen) return { _tag: "Unknown", id: accountId };
    return isOpen(chosen)
      ? { _tag: "Account", account: chosen.account }
      : { _tag: "AllLimited", resetsAtMs: nextReset(chosen.usage!) };
  }
  if (states.length === 0) return null;
  if (eligible.length === 0) return { _tag: "Unknown", id: "a verified Muse account" };
  const open = eligible.filter(isOpen);
  const best = open
    .filter((state) => state.usage !== null)
    .toSorted((a, b) => a.usage!.window.usedPercent - b.usage!.window.usedPercent)[0];
  if (best) return { _tag: "Account", account: best.account };
  if (open[0]) return { _tag: "Account", account: open[0].account };
  return {
    _tag: "AllLimited",
    resetsAtMs: Math.min(...eligible.map((state) => nextReset(state.usage!))),
  };
}
