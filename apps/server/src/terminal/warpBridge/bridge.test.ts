import { describe, expect, it } from "@effect/vitest";
import type { TerminalAttachStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makeWarpBridge, type WarpFrame, type WarpTerminalPort } from "./bridge.ts";
import { makeWarpTicketStore } from "./tickets.ts";

const ENVIRONMENT = "env-a";
const SIZE = { cols: 100, rows: 30 };

function makeFakes(options: { now?: () => number; history?: string } = {}) {
  const opens: Array<Parameters<WarpTerminalPort["open"]>[0]> = [];
  const closes: Array<Parameters<WarpTerminalPort["close"]>[0]> = [];
  const writes: string[] = [];
  const listeners = new Map<string, (event: TerminalAttachStreamEvent) => Effect.Effect<void>>();
  let nextPid = 4000;
  const terminals = {
    open: (input) =>
      Effect.sync(() => {
        opens.push(input);
        nextPid += 1;
        return {
          threadId: input.threadId,
          terminalId: input.terminalId,
          cwd: input.cwd,
          worktreePath: null,
          status: "running" as const,
          pid: nextPid,
          history: "",
          exitCode: null,
          exitSignal: null,
          label: "zsh",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      }),
    attachStream: (input, listener) =>
      Effect.gen(function* () {
        listeners.set(`${input.threadId}/${input.terminalId}`, listener);
        yield* listener({
          type: "snapshot",
          snapshot: {
            threadId: input.threadId,
            terminalId: input.terminalId,
            cwd: "/work",
            worktreePath: null,
            status: "running",
            pid: nextPid,
            history: options.history ?? "",
            exitCode: null,
            exitSignal: null,
            label: "zsh",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        });
        return () => listeners.delete(`${input.threadId}/${input.terminalId}`);
      }),
    write: (input) => Effect.sync(() => void writes.push(input.data)),
    resize: () => Effect.void,
    close: (input) => Effect.sync(() => void closes.push(input)),
  } satisfies WarpTerminalPort;
  const tickets = makeWarpTicketStore(options.now ? { now: options.now } : {});
  const bridge = makeWarpBridge({ terminals, tickets, environmentId: ENVIRONMENT });
  const frames: WarpFrame[] = [];
  const send = (frame: WarpFrame) => Effect.sync(() => void frames.push(frame));
  const mint = (
    terminalId: string,
    overrides: {
      environmentId?: string;
      threadId?: string;
      reattach?: boolean;
      label?: string;
      surface?: string;
    } = {},
  ) =>
    bridge.mintTicket({
      environmentId: overrides.environmentId ?? ENVIRONMENT,
      threadId: overrides.threadId ?? "thread-1",
      terminalId,
      cwd: "/work",
      worktreePath: null,
      ...(overrides.reattach !== undefined ? { reattach: overrides.reattach } : {}),
      ...(overrides.label !== undefined ? { label: overrides.label } : {}),
      ...(overrides.surface !== undefined ? { surface: overrides.surface } : {}),
    });
  return { bridge, opens, closes, writes, listeners, frames, send, mint };
}

describe("warp bridge destination guard", () => {
  it.effect(
    "rejects a wrong environment, a foreign terminal id, an expired and a reused ticket before any shell opens",
    () =>
      Effect.gen(function* () {
        let clock = 1_000;
        const fakes = makeFakes({ now: () => clock });

        expect(fakes.mint("warp-aaaa", { environmentId: "env-b" })).toMatchObject({
          ok: false,
          reason: "wrong_environment",
        });
        // A Ghostty terminal id can never be named through the Warp bridge.
        expect(fakes.mint("term-1")).toMatchObject({ ok: false, reason: "bad_terminal_id" });

        const expiring = fakes.mint("warp-bbbb");
        if (!expiring.ok) throw new Error("expected a ticket");
        clock += 61_000;
        expect(fakes.bridge.redeemTicket(expiring.ticket)).toEqual({
          ok: false,
          reason: "expired",
        });

        const fresh = fakes.mint("warp-cccc");
        if (!fresh.ok) throw new Error("expected a ticket");
        const first = fakes.bridge.redeemTicket(fresh.ticket);
        expect(first.ok).toBe(true);
        expect(fakes.bridge.redeemTicket(fresh.ticket)).toEqual({ ok: false, reason: "used" });
        expect(fakes.bridge.redeemTicket("not-a-ticket")).toEqual({ ok: false, reason: "unknown" });

        expect(fakes.opens).toHaveLength(0);

        // The redeemed ticket opens exactly the terminal it was minted for.
        if (!first.ok) return;
        yield* fakes.bridge.attach(first.binding, SIZE, fakes.send);
        expect(fakes.opens).toHaveLength(1);
        expect(fakes.opens[0]).toMatchObject({
          threadId: "thread-1",
          terminalId: "warp-cccc",
          shell: "zsh",
          cols: 100,
          rows: 30,
        });
      }),
  );
});

describe("warp bridge lifecycle", () => {
  it.effect("bootstraps once, refuses reattach, and closes only the named terminal", () =>
    Effect.gen(function* () {
      const fakes = makeFakes();
      const a = fakes.mint("warp-aaaa");
      const b = fakes.mint("warp-bbbb");
      if (!a.ok || !b.ok) throw new Error("expected tickets");
      const redeemedA = fakes.bridge.redeemTicket(a.ticket);
      const redeemedB = fakes.bridge.redeemTicket(b.ticket);
      if (!redeemedA.ok || !redeemedB.ok) throw new Error("expected bindings");

      const first = yield* fakes.bridge.attach(redeemedA.binding, SIZE, fakes.send);
      yield* fakes.bridge.attach(redeemedB.binding, SIZE, fakes.send);

      const ready = fakes.frames.filter(
        (frame) => frame.kind === "text" && frame.text.includes('"ready"'),
      );
      // One ready{bootstrap:true} per terminal, never more.
      expect(ready).toHaveLength(2);
      expect(fakes.opens).toHaveLength(2);

      // Hiding the pane keeps the guest mounted; a dropped socket detaches but keeps the shell.
      yield* first.detach;
      expect(fakes.bridge.listSessions("thread-1").map((s) => [s.terminalId, s.state])).toEqual([
        ["warp-aaaa", "detached"],
        ["warp-bbbb", "attached"],
      ]);

      // A plain ticket never re-bootstraps a shell that already has Warp's bootstrap.
      expect(fakes.mint("warp-aaaa")).toMatchObject({ ok: false, reason: "already_bound" });
      const direct = yield* fakes.bridge
        .attach(redeemedA.binding, SIZE, fakes.send)
        .pipe(Effect.flip);
      expect(direct.reason).toBe("unsupported_reattach");
      expect(fakes.opens).toHaveLength(2);
      expect(
        fakes.frames.filter((f) => f.kind === "text" && f.text.includes('"ready"')),
      ).toHaveLength(2);

      // Close is per terminal and refuses terminals the bridge does not own.
      expect(
        yield* fakes.bridge.closeSession({ threadId: "thread-1", terminalId: "warp-bbbb" }),
      ).toBe(true);
      expect(fakes.closes).toEqual([{ threadId: "thread-1", terminalId: "warp-bbbb" }]);
      expect(yield* fakes.bridge.closeSession({ threadId: "thread-1", terminalId: "term-1" })).toBe(
        false,
      );
      expect(fakes.closes).toHaveLength(1);
      expect(fakes.bridge.listSessions("thread-1").map((s) => s.terminalId)).toEqual(["warp-aaaa"]);
    }),
  );

  it.effect("keeps multibyte input intact across frame boundaries", () =>
    Effect.gen(function* () {
      const fakes = makeFakes();
      const minted = fakes.mint("warp-aaaa");
      if (!minted.ok) throw new Error("expected a ticket");
      const redeemed = fakes.bridge.redeemTicket(minted.ticket);
      if (!redeemed.ok) throw new Error("expected a binding");
      const attachment = yield* fakes.bridge.attach(redeemed.binding, SIZE, fakes.send);
      const bytes = new TextEncoder().encode("é€");
      yield* attachment.write(bytes.slice(0, 1));
      yield* attachment.write(bytes.slice(1, 3));
      yield* attachment.write(bytes.slice(3));
      expect(fakes.writes.join("")).toBe("é€");
    }),
  );
});

describe("warp bridge re-attach", () => {
  it.effect("re-attaches a running shell with bootstrap:false and replays its history first", () =>
    Effect.gen(function* () {
      const fakes = makeFakes({ history: "echo hi\r\nhi\r\n" });
      const minted = fakes.mint("warp-aaaa", { label: "Development", surface: "tab-1" });
      if (!minted.ok) throw new Error("expected a ticket");
      const redeemed = fakes.bridge.redeemTicket(minted.ticket);
      if (!redeemed.ok) throw new Error("expected a binding");
      const original = yield* fakes.bridge.attach(redeemed.binding, SIZE, fakes.send);
      fakes.frames.length = 0;

      // The page reloaded: the new guest attaches before the old socket is noticed closed.
      const again = fakes.mint("warp-aaaa", { reattach: true });
      if (!again.ok) throw new Error("expected a reattach ticket");
      const redeemedAgain = fakes.bridge.redeemTicket(again.ticket);
      if (!redeemedAgain.ok) throw new Error("expected a binding");
      expect(redeemedAgain.binding).toMatchObject({
        reattach: true,
        label: "Development",
        surface: "tab-1",
      });
      yield* fakes.bridge.attach(redeemedAgain.binding, SIZE, fakes.send);

      expect(fakes.frames[0]).toEqual({
        kind: "text",
        text: '{"type":"ready","bootstrap":false}',
      });
      expect(fakes.frames[1]).toMatchObject({ kind: "binary" });
      expect(new TextDecoder().decode((fakes.frames[1] as { bytes: Uint8Array }).bytes)).toBe(
        "echo hi\r\nhi\r\n",
      );

      // The stale socket closing late must not mark the live attachment detached.
      yield* original.detach;
      expect(fakes.bridge.listSessions("thread-1", "tab-1").map((s) => s.state)).toEqual([
        "attached",
      ]);
      // Sessions are scoped to their terminal tab; the drawer sees none of them.
      expect(fakes.bridge.listSessions("thread-1")).toEqual([]);
    }),
  );

  it.effect("refuses to re-attach a shell the bridge does not own or one that exited", () =>
    Effect.gen(function* () {
      const fakes = makeFakes();
      expect(fakes.mint("warp-zzzz", { reattach: true })).toMatchObject({
        ok: false,
        reason: "unknown_session",
      });

      const minted = fakes.mint("warp-aaaa");
      if (!minted.ok) throw new Error("expected a ticket");
      const redeemed = fakes.bridge.redeemTicket(minted.ticket);
      if (!redeemed.ok) throw new Error("expected a binding");
      yield* fakes.bridge.attach(redeemed.binding, SIZE, fakes.send);
      const listener = fakes.listeners.get("thread-1/warp-aaaa");
      if (!listener) throw new Error("expected a stream listener");
      yield* listener({
        type: "exited",
        threadId: "thread-1",
        terminalId: "warp-aaaa",
        createdAt: "2026-01-01T00:00:00.000Z",
        exitCode: 0,
        exitSignal: null,
      } as TerminalAttachStreamEvent);
      expect(fakes.mint("warp-aaaa", { reattach: true })).toMatchObject({
        ok: false,
        reason: "session_exited",
      });
    }),
  );
});
