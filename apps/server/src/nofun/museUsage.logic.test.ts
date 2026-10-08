import { describe, expect, it } from "vite-plus/test";

import {
  museSourceSnapshot,
  museUsageWindows,
  pickMuseAccount,
  type MuseAccountState,
  type MuseSubscriptionUsage,
} from "./museUsage.logic.ts";

const usage = (window: number, weekly: number): MuseSubscriptionUsage => ({
  window: { usedPercent: window, resetsAtMs: 1_000_000, windowDurationMins: 300 },
  weekly: { usedPercent: weekly, resetsAtMs: 9_000_000 },
  observedAtMs: 500,
});

const state = (label: string, reading: MuseSubscriptionUsage | null): MuseAccountState => ({
  account: { label },
  usage: reading,
  error: null,
  checkedAtMs: 500,
});

describe("pickMuseAccount", () => {
  it("routes to the subscription with the most five-hour room", () => {
    const pick = pickMuseAccount([state("Muse", usage(80, 10)), state("Muse 2", usage(20, 90))]);
    expect(pick).toEqual({ _tag: "Account", account: { label: "Muse 2" } });
  });

  it("skips a subscription that is out of weekly quota", () => {
    const pick = pickMuseAccount([state("Muse", usage(90, 40)), state("Muse 2", usage(5, 100))]);
    expect(pick).toEqual({ _tag: "Account", account: { label: "Muse" } });
  });

  it("still runs on an account it could not read rather than blocking work", () => {
    const pick = pickMuseAccount([state("Muse", usage(100, 40)), state("Muse 2", null)]);
    expect(pick).toEqual({ _tag: "Account", account: { label: "Muse 2" } });
  });

  it("names the earliest reset when every subscription is spent", () => {
    const spentWeekly: MuseSubscriptionUsage = {
      ...usage(10, 100),
      weekly: { usedPercent: 100, resetsAtMs: 400_000 },
    };
    const pick = pickMuseAccount([state("Muse", usage(100, 40)), state("Muse 2", spentWeekly)]);
    expect(pick).toEqual({ _tag: "AllLimited", resetsAtMs: 400_000 });
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
    const snapshot = museSourceSnapshot({ ...state("Muse 2", null), error: "Not logged in." });
    expect(snapshot).toMatchObject({ kind: "muse", label: "Muse 2", accounts: [] });
    expect(snapshot.error).toBe("Not logged in.");
  });
});
