import type { WarpPaneState } from "./protocol.ts";

/** What a Run or Insert is frozen to when the user triggers it. */
export interface WarpRunTarget {
  readonly paneId: string;
  readonly terminalId: string;
}

export interface WarpPaneSnapshot {
  readonly terminalId: string;
  readonly state: WarpPaneState;
}

export type WarpAdmission =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "duplicate_action" | "in_flight" | "stale_target" | "not_connected";
    };

export type WarpRunSettlement = "acknowledged" | "refused" | "unknown";

/**
 * At-most-once admission for Run. It is not an exactly-once claim: a lost
 * acknowledgement settles as UNKNOWN and the same action id is never admitted
 * again, so nothing replays a command that may already have executed.
 */
export function createRunAdmission() {
  const seenActions = new Set<string>();
  const inFlightPanes = new Set<string>();
  const paneByAction = new Map<string, string>();

  return {
    admit(
      actionId: string,
      target: WarpRunTarget,
      pane: WarpPaneSnapshot | undefined,
    ): WarpAdmission {
      if (seenActions.has(actionId)) return { ok: false, reason: "duplicate_action" };
      // A pane that was closed or rebound since the target was frozen is stale.
      if (pane === undefined || pane.terminalId !== target.terminalId) {
        return { ok: false, reason: "stale_target" };
      }
      if (pane.state !== "connected") return { ok: false, reason: "not_connected" };
      // A second click while the first is unanswered must not become a second submission.
      if (inFlightPanes.has(target.paneId)) return { ok: false, reason: "in_flight" };
      seenActions.add(actionId);
      inFlightPanes.add(target.paneId);
      paneByAction.set(actionId, target.paneId);
      return { ok: true };
    },
    settle(actionId: string, _settlement: WarpRunSettlement): void {
      const paneId = paneByAction.get(actionId);
      if (paneId !== undefined) inFlightPanes.delete(paneId);
      paneByAction.delete(actionId);
      // `seenActions` keeps the id so an UNKNOWN action can never be admitted twice.
    },
  };
}
