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
}

export type WarpFrame =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly bytes: Uint8Array };

export type WarpMintError =
  | { readonly reason: "wrong_environment" }
  | { readonly reason: "bad_terminal_id" }
  | { readonly reason: "already_bound" };

export type WarpAttachError =
  | { readonly reason: "unsupported_reattach" }
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
const READY_FRAME = '{"type":"ready","bootstrap":true}';
const exitFrame = (code: number | null) => `{"type":"exit","code":${code ?? "null"}}`;

export interface WarpBridge {
  readonly mintTicket: (input: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly worktreePath: string | null;
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
   * Opens the shell and starts streaming it. Sends `ready{bootstrap:true}`
   * exactly once, before any output. Refuses a terminal this bridge already
   * bound: Warp keeps no scrollback to restore, so a second attach would run
   * its bootstrap into a shell that already has one.
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
  readonly listSessions: (threadId: string) => ReadonlyArray<WarpSessionRecord>;
}

export function makeWarpBridge(deps: {
  readonly terminals: WarpTerminalPort;
  readonly tickets: WarpTicketStore;
  readonly environmentId: string;
}): WarpBridge {
  const sessions = new Map<string, WarpSessionRecord>();
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
      if (sessions.has(sessionKey(input.threadId, input.terminalId))) {
        return { ok: false, reason: "already_bound" };
      }
      const { ticket, expiresAt } = deps.tickets.mint({
        environmentId: deps.environmentId,
        threadId: input.threadId,
        terminalId: input.terminalId,
        cwd: input.cwd,
        worktreePath: input.worktreePath,
      });
      return { ok: true, ticket, expiresAt };
    },

    redeemTicket: (ticket) => deps.tickets.redeem(ticket),

    attach: (binding, size, send) =>
      Effect.gen(function* () {
        const key = sessionKey(binding.threadId, binding.terminalId);
        // Reserve before opening so a racing second attach cannot spawn a shell.
        if (sessions.has(key))
          return yield* Effect.fail({ reason: "unsupported_reattach" } as const);
        setRecord({
          threadId: binding.threadId,
          terminalId: binding.terminalId,
          generation: null,
          state: "opening",
        });

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
            Effect.tapError(() => Effect.sync(() => sessions.delete(key))),
            Effect.mapError((cause) => ({ reason: "open_failed", cause }) as const),
          );
        const generation = String(opened.pid ?? "unknown");
        const record = (state: WarpSessionState): WarpSessionRecord => ({
          threadId: binding.threadId,
          terminalId: binding.terminalId,
          generation,
          state,
        });
        setRecord(record("attached"));

        let readySent = false;
        const sendReady = Effect.suspend(() => {
          if (readySent) return Effect.void;
          readySent = true;
          return send({ kind: "text", text: READY_FRAME });
        });
        const sendOutput = (data: string) =>
          data.length === 0 ? Effect.void : send({ kind: "binary", bytes: encoder.encode(data) });

        const unsubscribe = yield* deps.terminals
          .attachStream({ threadId: binding.threadId, terminalId: binding.terminalId }, (event) => {
            switch (event.type) {
              case "snapshot":
                return sendReady.pipe(Effect.andThen(sendOutput(event.snapshot.history)));
              case "output":
                return sendOutput(event.data);
              case "exited":
                return Effect.sync(() => setRecord(record("exited"))).pipe(
                  Effect.andThen(send({ kind: "text", text: exitFrame(event.exitCode) })),
                );
              case "closed":
                return Effect.sync(() => sessions.delete(key)).pipe(
                  Effect.andThen(send({ kind: "text", text: exitFrame(null) })),
                );
              default:
                return Effect.void;
            }
          })
          .pipe(
            Effect.tapError(() => Effect.sync(() => sessions.delete(key))),
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
        return true;
      }),

    listSessions: (threadId) =>
      [...sessions.values()].filter((record) => record.threadId === threadId),
  };
}
