/**
 * Usage headroom for delegation routing: one verdict per provider instance
 * from its live quota windows, so an orchestrating agent can route around a
 * pool that is nearly spent and leave it for work only it can do.
 */
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";

export type UsageHeadroom = "ok" | "low" | "exhausted" | "unknown";

/** Below this share left, a window is worth preserving. */
const LOW_PERCENT = 15;
/** A nearly spent window that resets this soon does not count as low. */
const RESETS_SOON_MS = 60 * 60_000;

const WINDOW_NAME: Record<ServerProviderUsageWindow["kind"], string> = {
  session: "5h",
  weekly: "weekly",
  monthly: "monthly",
  other: "window",
};

function formatIn(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The windows that gate routing: per-model weekly windows are left out. */
function gatingWindows(limits: ServerProviderUsageLimits) {
  return limits.windows.filter(
    (window) => !(window.kind === "weekly" && window.label.includes("·")),
  );
}

export function usageHeadroom(
  limits: ServerProviderUsageLimits | undefined,
  nowMs: number,
): { readonly headroom: UsageHeadroom; readonly summary: string } {
  const windows = limits && !limits.unavailable ? gatingWindows(limits) : [];
  if (windows.length === 0) return { headroom: "unknown", summary: "usage not reported" };
  let headroom: UsageHeadroom = "ok";
  const parts = windows.map((window) => {
    const left = Math.max(0, Math.round(100 - window.usedPercent));
    const resetMs = window.resetsAt ? Date.parse(window.resetsAt) - nowMs : null;
    const resetsSoon = resetMs !== null && resetMs <= RESETS_SOON_MS;
    if (left <= 0 && !resetsSoon) headroom = "exhausted";
    else if (left < LOW_PERCENT && !resetsSoon && headroom !== "exhausted") headroom = "low";
    const reset = resetMs === null ? "" : ` (resets in ${formatIn(resetMs)})`;
    return `${WINDOW_NAME[window.kind]} ${left}% left${reset}`;
  });
  return { headroom, summary: parts.join(" · ") };
}
