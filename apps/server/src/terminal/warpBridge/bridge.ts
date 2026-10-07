import type { TerminalError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { TerminalManager } from "../Manager.ts";
import type { WarpBinding, WarpTicketRejection, WarpTicketStore } from "./tickets.ts";

/**
 * Transport compatibility service between the embedded Warp guest and the
 * existing `TerminalManager`. It owns no PTY: every shell is a normal T3
 * terminal, so history, metadata and shutdown stay the manager's.
 */
export type WarpTerminalPort = Pick<
  TerminalManager["Service"],
  "open" | "attachStream" | "write" | "resize" | "close"
>;

/** Warp terminals use their own id namespace so a guest can never name a Ghostty terminal. */
export const WARP_TERMINAL_ID_PATTERN = /^warp-[a-z0-9]{4,32}$/;

export type WarpSessionState = "opening" | "attached" | "detached" | "exited";

export interface WarpSessionRecord {
  readonly threadId: string;
  readonly terminalId: string;
  /** The shell's pid; changes whenever the underlying shell is replaced. */
  readonly generation: string | null;
  readonly state: WarpSessionState;
  readonly label: string | null;
  /** The right-panel terminal tab the shell belongs to; null for the bottom drawer. */
  readonly surface: string | null;
  /** Creation order within this server process; a reload re-opens panes oldest first. */
  readonly seq: number;
}

export type WarpFrame =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly bytes: Uint8Array };

export type WarpMintError =
  | { readonly reason: "wrong_environment" }
  | { readonly reason: "bad_terminal_id" }
  | { readonly reason: "already_bound" }
  | { readonly reason: "unknown_session" }
  | { readonly reason: "session_exited" };

export type WarpAttachError =
  | { readonly reason: "unsupported_reattach" }
  | { readonly reason: "unknown_session" }
  | { readonly reason: "open_failed"; readonly cause: TerminalError };

export interface WarpAttachment {
  readonly threadId: string;
  readonly terminalId: string;
  readonly generation: string;
  readonly write: (bytes: Uint8Array) => Effect.Effect<void, TerminalError>;
  readonly resize: (cols: number, rows: number) => Effect.Effect<void, TerminalError>;
  /** The socket went away. The shell keeps running; Warp cannot reattach it. */
  readonly detach: Effect.Effect<void>;
}

const sessionKey = (threadId: string, terminalId: string) => `${threadId}\0${terminalId}`;
const encoder = new TextEncoder();
const MAX_WRITE_CHARS = 60_000;
/** Control frames are fixed shapes; `code` is an integer or null, so no escaping is involved. */
/**
 * `resume:false` tells the guest to write nothing into a re-attached shell that is busy
 * (a running command, alt-screen), so it never types into a foreground program.
 */
const readyFrame = (bootstrap: boolean, resume = true) =>
  `{"type":"ready","bootstrap":${bootstrap}${resume ? "" : ',"resume":false'}}`;
const exitFrame = (code: number | null) => `{"type":"exit","code":${code ?? "null"}}`;

export interface WarpBridge {
  readonly mintTicket: (input: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly worktreePath: string | null;
    readonly label?: string | null;
    readonly surface?: string | null;
    /** Re-attach to a terminal this bridge already owns instead of opening a new shell. */
    readonly reattach?: boolean;
    readonly origin?: string | null;
  }) =>
    | { readonly ok: true; readonly ticket: string; readonly expiresAt: number }
    | ({
        readonly ok: false;
      } & WarpMintError);
  readonly redeemTicket: (
    ticket: string,
  ) =>
    | { readonly ok: true; readonly binding: WarpBinding }
    | { readonly ok: false; readonly reason: WarpTicketRejection };
  /**
   * Opens the shell (or re-attaches to a running one) and starts streaming it.
   * Sends `ready` exactly once, before any output: `bootstrap:true` for a new
   * shell, `bootstrap:false` for a re-attach, after which the manager's history
   * is replayed so the new guest shows what the shell already printed. A ticket
   * minted without `reattach` is refused for a terminal this bridge already
   * bound, so Warp's bootstrap can never run twice in one shell.
   */
  readonly attach: (
    binding: WarpBinding,
    size: { readonly cols: number; readonly rows: number },
    send: (frame: WarpFrame) => Effect.Effect<void>,
  ) => Effect.Effect<WarpAttachment, WarpAttachError>;
  /** Closes exactly one bridge-owned terminal. Returns false for a terminal the bridge does not own. */
  readonly closeSession: (input: {
    readonly threadId: string;
    readonly terminalId: string;
  }) => Effect.Effect<boolean, TerminalError>;
  /** Sessions of one thread in creation order; `surface` narrows to one terminal tab (null = the drawer). */
  readonly listSessions: (
    threadId: string,
    surface?: string | null,
  ) => ReadonlyArray<WarpSessionRecord>;
}

export function makeWarpBridge(deps: {
  readonly terminals: WarpTerminalPort;
  readonly tickets: WarpTicketStore;
  readonly environmentId: string;
}): WarpBridge {
  const sessions = new Map<string, WarpSessionRecord>();
  /** The terminal label while its shell sits at the prompt; any other label means a command is running. */
  const idleLabels = new Map<string, string>();
  let sequence = 0;
  /** Which attachment owns a terminal now; a stale socket closing late must not mark it detached. */
  const currentAttachment = new Map<string, number>();
  const setRecord = (record: WarpSessionRecord) =>
    sessions.set(sessionKey(record.threadId, record.terminalId), record);

  return {
    mintTicket: (input) => {
      if (input.environmentId !== deps.environmentId) {
        return { ok: false, reason: "wrong_environment" };
      }
      if (!WARP_TERMINAL_ID_PATTERN.test(input.terminalId)) {
        return { ok: false, reason: "bad_terminal_id" };
      }
      const existing = sessions.get(sessionKey(input.threadId, input.terminalId));
      const reattach = input.reattach === true;
      if (reattach) {
        if (existing === undefined) return { ok: false, reason: "unknown_session" };
        if (existing.state === "exited") return { ok: false, reason: "session_exited" };
      } else if (existing !== undefined) {
        return { ok: false, reason: "already_bound" };
      }
      const { ticket, expiresAt } = deps.tickets.mint({
        environmentId: deps.environmentId,
        threadId: input.threadId,
        terminalId: input.terminalId,
        cwd: input.cwd,
        worktreePath: input.worktreePath,
        label: input.label ?? existing?.label ?? null,
        surface: existing?.surface ?? input.surface ?? null,
        reattach,
        origin: input.origin ?? null,
      });
      return { ok: true, ticket, expiresAt };
    },

    redeemTicket: (ticket) => deps.tickets.redeem(ticket),

    attach: (binding, size, send) =>
      Effect.gen(function* () {
        const key = sessionKey(binding.threadId, binding.terminalId);
        const existing = sessions.get(key);
        if (binding.reattach) {
          if (existing === undefined)
            return yield* Effect.fail({ reason: "unknown_session" } as const);
        } else {
          // Reserve before opening so a racing second attach cannot spawn a shell.
          if (existing !== undefined)
            return yield* Effect.fail({ reason: "unsupported_reattach" } as const);
          setRecord({
            threadId: binding.threadId,
            terminalId: binding.terminalId,
            generation: null,
            state: "opening",
            label: binding.label,
            surface: binding.surface,
            seq: ++sequence,
          });
        }
        const bootstrap = !binding.reattach;
        const seq = existing?.seq ?? sequence;
        const attachmentId = ++sequence;
        currentAttachment.set(key, attachmentId);

        const opened = yield* deps.terminals
          .open({
            threadId: binding.threadId,
            terminalId: binding.terminalId,
            cwd: binding.cwd,
            ...(binding.worktreePath !== null ? { worktreePath: binding.worktreePath } : {}),
            cols: size.cols,
            rows: size.rows,
            env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
            shell: "zsh",
          })
          .pipe(
            Effect.tapError(() =>
              Effect.sync(() => (bootstrap ? sessions.delete(key) : undefined)),
            ),
            Effect.mapError((cause) => ({ reason: "open_failed", cause }) as const),
          );
        const generation = String(opened.pid ?? "unknown");
        if (bootstrap) idleLabels.set(key, opened.label);
        // A re-attached shell whose label differs from its at-prompt label is running a command.
        const busy = !bootstrap && opened.label !== (idleLabels.get(key) ?? opened.label);
        const record = (state: WarpSessionState): WarpSessionRecord => ({
          threadId: binding.threadId,
          terminalId: binding.terminalId,
          generation,
          state,
          label: binding.label,
          surface: binding.surface,
          seq,
        });
        setRecord(record("attached"));

        let readySent = false;
        const sendReady = Effect.suspend(() => {
          if (readySent) return Effect.void;
          readySent = true;
          return send({ kind: "text", text: readyFrame(bootstrap, !busy) });
        });
        const sendOutput = (data: string) =>
          data.length === 0 ? Effect.void : send({ kind: "binary", bytes: encoder.encode(data) });

        const unsubscribe = yield* deps.terminals
          .attachStream({ threadId: binding.threadId, terminalId: binding.terminalId }, (event) => {
            switch (event.type) {
              case "snapshot":
                return sendReady.pipe(
                  Effect.andThen(sendOutput(event.snapshot.history)),
                  // A shell that exited while no guest was attached still says so on re-attach.
                  Effect.andThen(
                    event.snapshot.status === "exited"
                      ? Effect.sync(() => setRecord(record("exited"))).pipe(
                          Effect.andThen(
                            send({ kind: "text", text: exitFrame(event.snapshot.exitCode) }),
                          ),
                        )
                      : Effect.void,
                  ),
                );
              case "output":
                return sendOutput(event.data);
              case "exited":
                return Effect.sync(() => setRecord(record("exited"))).pipe(
                  Effect.andThen(send({ kind: "text", text: exitFrame(event.exitCode) })),
                );
              case "closed":
                return Effect.sync(() => {
                  sessions.delete(key);
                  currentAttachment.delete(key);
                  idleLabels.delete(key);
                }).pipe(Effect.andThen(send({ kind: "text", text: exitFrame(null) })));
              default:
                return Effect.void;
            }
          })
          .pipe(
            Effect.tapError(() =>
              Effect.sync(() => (bootstrap ? sessions.delete(key) : undefined)),
            ),
            Effect.mapError((cause) => ({ reason: "open_failed", cause }) as const),
          );

        const decoder = new TextDecoder();
        const attachment: WarpAttachment = {
          threadId: binding.threadId,
          terminalId: binding.terminalId,
          generation,
          write: (bytes) => {
            // Streaming decode keeps a multibyte sequence split across frames intact.
            const text = decoder.decode(bytes, { stream: true });
            const writes: Array<Effect.Effect<void, TerminalError>> = [];
            for (let at = 0; at < text.length; at += MAX_WRITE_CHARS) {
              writes.push(
                deps.terminals.write({
                  threadId: binding.threadId,
                  terminalId: binding.terminalId,
                  data: text.slice(at, at + MAX_WRITE_CHARS),
                }),
              );
            }
            return Effect.forEach(writes, (write) => write, { discard: true });
          },
          resize: (cols, rows) =>
            deps.terminals.resize({
              threadId: binding.threadId,
              terminalId: binding.terminalId,
              cols,
              rows,
            }),
          detach: Effect.sync(() => {
            unsubscribe();
            if (currentAttachment.get(key) !== attachmentId) return;
            const current = sessions.get(key);
            if (current && current.state === "attached") setRecord(record("detached"));
          }),
        };
        return attachment;
      }),

    closeSession: ({ threadId, terminalId }) =>
      Effect.gen(function* () {
        const key = sessionKey(threadId, terminalId);
        if (!sessions.has(key)) return false;
        yield* deps.terminals.close({ threadId, terminalId });
        sessions.delete(key);
        currentAttachment.delete(key);
        idleLabels.delete(key);
        return true;
      }),

    listSessions: (threadId, surface = null) =>
      [...sessions.values()]
        .filter((record) => record.threadId === threadId && record.surface === surface)
        .toSorted((a, b) => a.seq - b.seq),
  };
}
