import { useSyncExternalStore } from "react";

export type WarpRefusal =
  | "busy"
  | "not_connected"
  | "stale_target"
  | "in_flight"
  | "duplicate_action"
  | "no_session"
  | "unknown"
  | "error";

export type WarpActionOutcome =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly reason: WarpRefusal; readonly label: string | null };

/** What the host can ask a mounted Warp panel to do. */
export interface WarpPanelHandle {
  /** The session Run and Insert would target right now, or null when none is connected. */
  readonly activeTarget: () => { readonly label: string } | null;
  /** Submits once through Warp's own input. Refuses busy, stale and unknown state. */
  readonly run: (text: string) => Promise<WarpActionOutcome>;
  /** Puts text in Warp's input editor without submitting. */
  readonly insert: (text: string) => Promise<WarpActionOutcome>;
}

const panels = new Map<string, WarpPanelHandle>();
let visibleKey: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export function registerWarpPanel(threadKey: string, handle: WarpPanelHandle): () => void {
  panels.set(threadKey, handle);
  emit();
  return () => {
    if (panels.get(threadKey) === handle) panels.delete(threadKey);
    if (visibleKey === threadKey) visibleKey = null;
    emit();
  };
}

/** Marks which thread's panel is on screen; Insert in chat code blocks follows it. */
export function setVisibleWarpPanel(threadKey: string, visible: boolean): void {
  const next = visible ? threadKey : visibleKey === threadKey ? null : visibleKey;
  if (next === visibleKey) return;
  visibleKey = next;
  emit();
}

export function getWarpPanel(threadKey: string): WarpPanelHandle | undefined {
  return panels.get(threadKey);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The visible panel, if any. Chat code blocks use this to offer Insert. */
export function useVisibleWarpPanel(): WarpPanelHandle | null {
  return useSyncExternalStore(
    subscribe,
    () => (visibleKey === null ? null : (panels.get(visibleKey) ?? null)),
    () => null,
  );
}

export function describeWarpRefusal(outcome: Extract<WarpActionOutcome, { ok: false }>): string {
  const where = outcome.label ? ` in ${outcome.label}` : "";
  switch (outcome.reason) {
    case "busy":
      return `${outcome.label ?? "That session"} is busy, so nothing was sent. Insert the command instead, or open another Warp session.`;
    case "not_connected":
      return `The Warp session is not connected yet, so nothing was sent${where}.`;
    case "stale_target":
      return "That Warp session changed or closed, so nothing was sent.";
    case "in_flight":
      return "A previous Run is still waiting on Warp, so nothing was sent.";
    case "duplicate_action":
      return "That Run was already submitted once, so it was not sent again.";
    case "no_session":
      return "No Warp session is ready. Open the terminal and wait for a prompt, then try again.";
    case "unknown":
      return `Warp did not confirm the command${where}. It may or may not have run; check the session before trying again.`;
    case "error":
      return `Warp reported an error${where}, so the command was not run.`;
  }
}
