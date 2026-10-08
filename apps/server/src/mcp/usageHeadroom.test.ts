import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { usageHeadroom } from "./usageHeadroom.ts";

const NOW = Date.parse("2026-10-08T00:00:00.000Z");
const at = (minutes: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW + minutes * 60_000));

const window = (
  kind: ServerProviderUsageWindow["kind"],
  usedPercent: number,
  resetsInMinutes: number,
  label: string = kind,
): ServerProviderUsageWindow => ({
  id: `${kind}-${label}`,
  kind,
  label,
  usedPercent,
  resetsAt: at(resetsInMinutes),
});

const limits = (...windows: ServerProviderUsageWindow[]) => ({
  checkedAt: at(0),
  windows,
});

describe("usageHeadroom", () => {
  it("flags a nearly spent weekly window as low and says when it resets", () => {
    const result = usageHeadroom(
      limits(window("session", 4, 200), window("weekly", 96, 3 * 24 * 60)),
      NOW,
    );
    expect(result.headroom).toBe("low");
    expect(result.summary).toBe(
      "5h 96% left (resets in 3h 20m) · weekly 4% left (resets in 3d 0h)",
    );
  });

  it("treats a spent pool as exhausted", () => {
    expect(usageHeadroom(limits(window("monthly", 100, 600)), NOW).headroom).toBe("exhausted");
  });

  it("does not hold back a pool that resets within the hour", () => {
    expect(usageHeadroom(limits(window("monthly", 100, 20)), NOW).headroom).toBe("ok");
  });

  it("ignores per-model weekly windows", () => {
    const result = usageHeadroom(
      limits(window("weekly", 10, 900), window("weekly", 99, 900, "Weekly · Opus")),
      NOW,
    );
    expect(result.headroom).toBe("ok");
  });

  it("is unknown when the provider reports no windows", () => {
    expect(usageHeadroom(undefined, NOW)).toEqual({
      headroom: "unknown",
      summary: "usage not reported",
    });
  });
});
