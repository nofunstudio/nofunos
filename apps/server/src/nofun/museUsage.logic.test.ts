import { describe, expect, it } from "vite-plus/test";

import {
  museChildEnvironment,
  museSourceSnapshot,
  museUsageWindows,
  pickMuseAccount,
  type MuseAccount,
  type MuseAccountState,
  type MuseSubscriptionUsage,
} from "./museUsage.logic.ts";

const usage = (window: number, weekly: number): MuseSubscriptionUsage => ({
  window: { usedPercent: window, resetsAtMs: 1_000_000, windowDurationMins: 300 },
  weekly: { usedPercent: weekly, resetsAtMs: 9_000_000 },
  observedAtMs: 500,
});

const account = (id: string, expectedEmail?: string): MuseAccount => ({
  id,
  label: id,
  ...(expectedEmail ? { expectedEmail } : {}),
});

const state = (
  id: string,
  reading: MuseSubscriptionUsage | null,
  extra: Partial<MuseAccountState> = {},
): MuseAccountState => ({
  account: account(id),
  signedInAs: null,
  usage: reading,
  error: null,
  checkedAtMs: 500,
  ...extra,
});

const picked = (pick: ReturnType<typeof pickMuseAccount>) =>
  pick?._tag === "Account" ? pick.account.id : pick;

describe("pickMuseAccount", () => {
  it("routes pool work to the subscription with the most five-hour room", () => {
    expect(picked(pickMuseAccount([state("a", usage(80, 10)), state("b", usage(20, 90))]))).toBe(
      "b",
    );
  });

  it("schedules fresh work on the other account when one is limited", () => {
    expect(picked(pickMuseAccount([state("a", usage(100, 40)), state("b", usage(60, 10))]))).toBe(
      "b",
    );
  });

  it("refuses an explicit account that is limited rather than moving the work", () => {
    expect(pickMuseAccount([state("a", usage(100, 40)), state("b", usage(5, 5))], "a")).toEqual({
      _tag: "AllLimited",
      resetsAtMs: 1_000_000,
    });
  });

  it("refuses an unknown explicit account", () => {
    expect(pickMuseAccount([state("a", usage(5, 5))], "zzz")).toEqual({
      _tag: "Unknown",
      id: "zzz",
    });
  });

  it("never runs an account signed in as someone else", () => {
    const wrong = state("a", usage(0, 0), {
      account: account("a", "me@example.com"),
      signedInAs: "other@example.com",
    });
    expect(picked(pickMuseAccount([wrong, state("b", usage(50, 50))]))).toBe("b");
    expect(pickMuseAccount([wrong])).toEqual({ _tag: "Unknown", id: "a verified Muse account" });
  });

  it("still runs on an account it could not read rather than blocking work", () => {
    expect(picked(pickMuseAccount([state("a", usage(100, 40)), state("b", null)]))).toBe("b");
  });

  it("names the earliest reset when every subscription is spent", () => {
    const spentWeekly: MuseSubscriptionUsage = {
      ...usage(10, 100),
      weekly: { usedPercent: 100, resetsAtMs: 400_000 },
    };
    expect(pickMuseAccount([state("a", usage(100, 40)), state("b", spentWeekly)])).toEqual({
      _tag: "AllLimited",
      resetsAtMs: 400_000,
    });
  });
});

describe("museChildEnvironment", () => {
  it("refuses the route when META_API_KEY is set instead of stripping it", () => {
    expect(museChildEnvironment(account("a"), { META_API_KEY: "x" })).toHaveProperty("refused");
  });

  it("drops inherited account routing and applies the account's own roots", () => {
    const result = museChildEnvironment(
      { ...account("a"), configHome: "/c", dataHome: "/d" },
      { PATH: "/bin", MUSE_AUTH_PATH: "/other/auth.json", TBH_CREDENTIAL_BACKEND: "file" },
    );
    expect(result).toEqual({ env: { PATH: "/bin", XDG_CONFIG_HOME: "/c", XDG_DATA_HOME: "/d" } });
  });
});

describe("museUsageWindows", () => {
  it("caps over-quota percentages at the contract's 100", () => {
    const [session, weekly] = museUsageWindows(usage(130, 2));
    expect(session).toMatchObject({ id: "five_hour", kind: "session", usedPercent: 100 });
    expect(session?.resetsAt).toBe("1970-01-01T00:16:40.000Z");
    expect(weekly).toMatchObject({ kind: "weekly", usedPercent: 2 });
  });
});

describe("museSourceSnapshot", () => {
  it("keeps a failing subscription visible with its error", () => {
    const snapshot = museSourceSnapshot({ ...state("b", null), error: "Not logged in." });
    expect(snapshot).toMatchObject({ id: "muse:b", kind: "muse", accounts: [] });
    expect(snapshot.error).toBe("Not logged in.");
  });
});
