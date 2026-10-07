/**
 * The `nofun-warp/1` host <-> guest bridge. The guest is the embedded Warp web
 * build; the contract is owned by the Warp side (nofun-embed/CONTRACT.md).
 */
export const WARP_PROTOCOL = "nofun-warp/1";

/** Warp terminals live in their own id namespace (mirrors the server bridge) so Ghostty never lists them. */
export const isWarpTerminalId = (terminalId: string): boolean =>
  /^warp-[a-z0-9]{4,32}$/.test(terminalId);

export type WarpPaneState = "connecting" | "connected" | "exited" | "disconnected" | "error";

export type WarpActionFailure =
  | "busy"
  | "not_bound"
  | "no_active_terminal"
  | "unknown_pane"
  | "error";

export type WarpGuestMessage =
  | { readonly type: "ready" }
  | { readonly type: "requestSession"; readonly paneId: string }
  | {
      readonly type: "activeTerminal";
      readonly paneId: string;
      readonly terminalId: string | null;
    }
  | {
      readonly type: "sessionState";
      readonly paneId: string;
      readonly terminalId: string | null;
      readonly state: WarpPaneState;
      readonly exitCode: number | null;
      readonly message: string | null;
    }
  | {
      readonly type: "askInT3";
      readonly paneId: string;
      readonly terminalId: string | null;
      readonly command: string | null;
      readonly output: string;
      readonly outputTruncated: boolean;
      readonly cwd: string | null;
      readonly exitCode: number | null;
    }
  | {
      readonly type: "actionResult";
      readonly actionId: string;
      readonly ok: boolean;
      readonly reason: WarpActionFailure | null;
      readonly message: string | null;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const int = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const PANE_STATES: ReadonlySet<string> = new Set([
  "connecting",
  "connected",
  "exited",
  "disconnected",
  "error",
]);
const ACTION_FAILURES: ReadonlySet<string> = new Set([
  "busy",
  "not_bound",
  "no_active_terminal",
  "unknown_pane",
  "error",
]);

/** Validates one guest message. Anything malformed or from another protocol is dropped. */
export function parseGuestMessage(data: unknown): WarpGuestMessage | null {
  if (!isRecord(data) || data.protocol !== WARP_PROTOCOL) return null;
  switch (data.type) {
    case "ready":
      return { type: "ready" };
    case "requestSession": {
      const paneId = str(data.paneId);
      return paneId ? { type: "requestSession", paneId } : null;
    }
    case "activeTerminal": {
      const paneId = str(data.paneId);
      return paneId ? { type: "activeTerminal", paneId, terminalId: str(data.terminalId) } : null;
    }
    case "sessionState": {
      const paneId = str(data.paneId);
      const state = str(data.state);
      if (!paneId || !state || !PANE_STATES.has(state)) return null;
      return {
        type: "sessionState",
        paneId,
        terminalId: str(data.terminalId),
        state: state as WarpPaneState,
        exitCode: int(data.exitCode),
        message: str(data.message),
      };
    }
    case "askInT3": {
      const paneId = str(data.paneId);
      const output = str(data.output);
      if (!paneId || output === null) return null;
      return {
        type: "askInT3",
        paneId,
        terminalId: str(data.terminalId),
        command: str(data.command),
        output,
        outputTruncated: data.outputTruncated === true,
        cwd: str(data.cwd),
        exitCode: int(data.exitCode),
      };
    }
    case "actionResult": {
      const actionId = str(data.actionId);
      if (!actionId || typeof data.ok !== "boolean") return null;
      const reason = str(data.reason);
      return {
        type: "actionResult",
        actionId,
        ok: data.ok,
        reason: reason && ACTION_FAILURES.has(reason) ? (reason as WarpActionFailure) : null,
        message: str(data.message),
      };
    }
    default:
      return null;
  }
}

export const withProtocol = <T extends { readonly type: string }>(message: T) => ({
  protocol: WARP_PROTOCOL,
  ...message,
});
