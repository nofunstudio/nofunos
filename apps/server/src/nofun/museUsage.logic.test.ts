import { describe, expect, it } from "vite-plus/test";

import {
  museChildEnvironment,
  museSourceSnapshot,
  museUsageWindows,
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
