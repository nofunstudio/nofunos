// @effect-diagnostics-next-line nodeBuiltinImport:off -- Synchronous random bytes for an in-memory ticket store.
import * as NodeCrypto from "node:crypto";

/**
 * What a Warp attach ticket authorizes: opening one new Zsh terminal in one
 * thread of one environment, or re-attaching to one this bridge already owns. The shell's generation (its pid) does not exist
 * yet; the bridge assigns it when the shell opens.
 */
export interface WarpBinding {
  readonly environmentId: string;
  readonly threadId: string;
  readonly terminalId: string;
  readonly cwd: string;
  readonly worktreePath: string | null;
  /** The thread's project root, so the shell can export it; absent when the client did not send one. */
  readonly projectRoot?: string | null;
  /** Shown on the pane and returned by `listSessions` so a reload restores the same names. */
  readonly label: string | null;
  /** The right-panel terminal tab this shell belongs to; null for the bottom drawer. */
  readonly surface: string | null;
  /** True when the terminal already exists and a new page is re-attaching to it. */
  readonly reattach: boolean;
  /**
   * The `Origin` the attach socket must present. `null` means the minting
   * request carried none, so no origin pin is possible.
   */
  readonly origin: string | null;
}

export type WarpTicketRejection = "unknown" | "expired" | "used";

export type WarpTicketRedemption =
  | { readonly ok: true; readonly binding: WarpBinding }
  | { readonly ok: false; readonly reason: WarpTicketRejection };

export interface WarpTicketStore {
  readonly mint: (binding: WarpBinding) => { readonly ticket: string; readonly expiresAt: number };
  /** Single use: the first redemption consumes the ticket, success or not. */
  readonly redeem: (ticket: string) => WarpTicketRedemption;
}

export const WARP_TICKET_TTL_MS = 60_000;
const MAX_LIVE_TICKETS = 256;

export function makeWarpTicketStore(
  options: {
    readonly now?: () => number;
    readonly ttlMs?: number;
    readonly token?: () => string;
  } = {},
): WarpTicketStore {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? WARP_TICKET_TTL_MS;
  const token = options.token ?? (() => NodeCrypto.randomBytes(32).toString("base64url"));
  const live = new Map<string, { binding: WarpBinding; expiresAt: number }>();
  // A ticket id that was already consumed stays recognizable as "used" until it would have expired.
  const spent = new Map<string, number>();

  const sweep = () => {
    const at = now();
    for (const [ticket, entry] of live) if (entry.expiresAt <= at) live.delete(ticket);
    for (const [ticket, until] of spent) if (until <= at) spent.delete(ticket);
  };

  return {
    mint: (binding) => {
      sweep();
      if (live.size >= MAX_LIVE_TICKETS) {
        // Oldest first; Map iterates in insertion order.
        const oldest = live.keys().next().value;
        if (oldest !== undefined) live.delete(oldest);
      }
      const ticket = token();
      const expiresAt = now() + ttlMs;
      live.set(ticket, { binding, expiresAt });
      return { ticket, expiresAt };
    },
    redeem: (ticket) => {
      const entry = live.get(ticket);
      if (entry === undefined) {
        return { ok: false, reason: spent.has(ticket) ? "used" : "unknown" };
      }
      live.delete(ticket);
      spent.set(ticket, entry.expiresAt);
      if (entry.expiresAt <= now()) return { ok: false, reason: "expired" };
      return { ok: true, binding: entry.binding };
    },
  };
}
