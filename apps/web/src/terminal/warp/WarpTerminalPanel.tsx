import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { X } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn, randomUUID } from "~/lib/utils";
import type { TerminalContextSelection } from "~/lib/terminalContext";
import { readWarpAccess, warpRequest, WarpRequestError } from "./access.ts";
import { buildWarpTerminalContext } from "./askContext.ts";
import {
  parseGuestMessage,
  withProtocol,
  type WarpGuestMessage,
  type WarpPaneState,
} from "./protocol.ts";
import {
  describeWarpRefusal,
  registerWarpPanel,
  setVisibleWarpPanel,
  type WarpActionOutcome,
} from "./registry.ts";
import { createRunAdmission } from "./runAdmission.ts";

const SESSION_LABELS = ["Development", "Tests", "Scratch"];
const ACTION_ACK_TIMEOUT_MS = 8_000;
const MIN_HEIGHT = 180;
const MAX_HEIGHT_RATIO = 0.75;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface PaneInfo {
  readonly paneId: string;
  readonly terminalId: string;
  readonly label: string;
  readonly state: WarpPaneState;
  readonly exitCode: number | null;
  readonly message: string | null;
}

interface ServerSession {
  readonly terminalId: string;
  readonly generation: string | null;
  readonly state: "opening" | "attached" | "detached" | "exited";
}

type BundleState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly origin: string }
  | { readonly state: "missing"; readonly message: string }
  | { readonly state: "error"; readonly message: string };

const STATE_DOT: Record<WarpPaneState, string> = {
  connecting: "bg-warning",
  connected: "bg-success",
  exited: "bg-muted-foreground",
  disconnected: "bg-muted-foreground",
  error: "bg-destructive",
};

const randomTerminalId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `warp-${Array.from(bytes, (byte) => (byte % 36).toString(36)).join("")}`;
};

export interface WarpThreadTerminalPanelProps {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly worktreePath: string | null | undefined;
  readonly visible: boolean;
  readonly height: number;
  readonly focusRequestId: number;
  readonly onHeightChange: (height: number) => void;
  readonly onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

/**
 * The experimental Warp terminal for one thread: one embedded Warp workspace
 * whose panes each bind to their own T3 terminal through the bridge. The
 * iframe stays mounted while the drawer is hidden, so hiding detaches
 * presentation, not shells.
 */
export function WarpThreadTerminalPanel({
  threadRef,
  cwd,
  worktreePath,
  visible,
  height,
  focusRequestId,
  onHeightChange,
  onAddTerminalContext,
}: WarpThreadTerminalPanelProps) {
  const environmentId: EnvironmentId = threadRef.environmentId;
  const threadId = threadRef.threadId;
  const threadKey = `${environmentId}:${threadId}`;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [bundle, setBundle] = useState<BundleState>({ state: "loading" });
  const [panes, setPanesState] = useState<ReadonlyMap<string, PaneInfo>>(new Map());
  const panesRef = useRef<ReadonlyMap<string, PaneInfo>>(panes);
  const [activePaneId, setActivePaneState] = useState<string | null>(null);
  const activePaneRef = useRef<string | null>(null);
  const [serverSessions, setServerSessions] = useState<ReadonlyArray<ServerSession>>([]);
  const boundPanesRef = useRef(new Set<string>());
  const labelCountRef = useRef(0);
  const admissionRef = useRef(createRunAdmission());
  const pendingActionsRef = useRef(new Map<string, (ok: WarpGuestMessage | null) => void>());
  const [drawerHeight, setDrawerHeight] = useState(height);
  const [resizing, setResizing] = useState(false);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const setPanes = useCallback(
    (update: (current: ReadonlyMap<string, PaneInfo>) => ReadonlyMap<string, PaneInfo>) => {
      const next = update(panesRef.current);
      panesRef.current = next;
      setPanesState(next);
    },
    [],
  );
  const setActivePane = useCallback((paneId: string | null) => {
    activePaneRef.current = paneId;
    setActivePaneState(paneId);
  }, []);

  const loadBundle = useCallback(async () => {
    setBundle({ state: "loading" });
    try {
      const access = await readWarpAccess(environmentId);
      if (access === null) throw new Error("Not connected to this environment yet.");
      const status = await warpRequest<
        { state: "ready"; origin: string } | { state: "missing"; message: string }
      >(access, "/bundle");
      setBundle(
        status.state === "ready"
          ? { state: "ready", origin: status.origin }
          : { state: "missing", message: status.message },
      );
    } catch (error) {
      setBundle({
        state: "error",
        message: error instanceof Error ? error.message : "Could not reach the Warp bridge.",
      });
    }
  }, [environmentId]);

  useEffect(() => {
    void loadBundle();
  }, [loadBundle]);

  const refreshSessions = useCallback(async () => {
    try {
      const access = await readWarpAccess(environmentId);
      if (access === null) return;
      const result = await warpRequest<{ sessions: ReadonlyArray<ServerSession> }>(
        access,
        `/sessions?threadId=${encodeURIComponent(threadId)}`,
      );
      setServerSessions(result.sessions);
    } catch {
      // The chips fall back to what the guest reported.
    }
  }, [environmentId, threadId]);

  const bundleOrigin = bundle.state === "ready" ? bundle.origin : null;
  const iframeSrc = useMemo(
    () =>
      bundleOrigin === null
        ? null
        : `${bundleOrigin}/?parentOrigin=${encodeURIComponent(window.location.origin)}`,
    [bundleOrigin],
  );

  const postToGuest = useCallback(
    (message: { readonly type: string } & Record<string, unknown>) => {
      if (bundleOrigin === null) return;
      iframeRef.current?.contentWindow?.postMessage(withProtocol(message), bundleOrigin);
    },
    [bundleOrigin],
  );

  const bindPane = useEffectEvent(async (paneId: string) => {
    if (boundPanesRef.current.has(paneId)) return;
    boundPanesRef.current.add(paneId);
    const index = labelCountRef.current++;
    const label = SESSION_LABELS[index] ?? `Session ${index + 1}`;
    const terminalId = randomTerminalId();
    setPanes((current) =>
      new Map(current).set(paneId, {
        paneId,
        terminalId,
        label,
        state: "connecting",
        exitCode: null,
        message: null,
      }),
    );
    const fail = (message: string) => {
      postToGuest({ type: "sessionError", paneId, message });
      setPanes((current) => {
        const pane = current.get(paneId);
        return pane ? new Map(current).set(paneId, { ...pane, state: "error", message }) : current;
      });
    };
    try {
      const access = await readWarpAccess(environmentId);
      if (access === null) return fail("Not connected to this environment yet.");
      // The guest only allows loopback WebSockets; say so instead of failing silently.
      if (!LOOPBACK_HOSTS.has(new URL(access.wsBase).host.replace(/:\d+$/, ""))) {
        return fail(
          "Warp needs a loopback connection (localhost or 127.0.0.1) to its terminal server.",
        );
      }
      const minted = await warpRequest<{ ticket: string }>(access, "/session", {
        method: "POST",
        body: {
          environmentId,
          threadId,
          terminalId,
          cwd,
          worktreePath: worktreePath ?? null,
        },
      });
      postToGuest({
        type: "session",
        paneId,
        terminalId,
        label,
        url: `${access.wsBase}/attach?ticket=${encodeURIComponent(minted.ticket)}`,
      });
    } catch (error) {
      fail(
        error instanceof WarpRequestError || error instanceof Error
          ? error.message
          : "Could not start a Warp session.",
      );
    }
  });

  const handleGuestMessage = useEffectEvent((message: WarpGuestMessage) => {
    switch (message.type) {
      case "ready":
        // A new guest instance starts with no panes; anything bound to the
        // previous one is gone (its shells show up as detached).
        boundPanesRef.current.clear();
        labelCountRef.current = 0;
        setPanes(() => new Map());
        setActivePane(null);
        void refreshSessions();
        return;
      case "requestSession":
        void bindPane(message.paneId);
        return;
      case "activeTerminal":
        if (panesRef.current.has(message.paneId)) setActivePane(message.paneId);
        return;
      case "sessionState":
        setPanes((current) => {
          const pane = current.get(message.paneId);
          if (!pane) return current;
          return new Map(current).set(message.paneId, {
            ...pane,
            state: message.state,
            exitCode: message.exitCode,
            message: message.message,
          });
        });
        void refreshSessions();
        return;
      case "askInT3": {
        const pane = panesRef.current.get(message.paneId);
        if (!pane) return;
        onAddTerminalContext(
          buildWarpTerminalContext({
            message,
            terminalId: pane.terminalId,
            sessionLabel: pane.label,
            workspaceRoot: cwd,
          }),
        );
        toastManager.add(
          stackedThreadToast({
            type: "info",
            title: `Added ${pane.label} output to the composer`,
          }),
        );
        return;
      }
      case "actionResult":
        pendingActionsRef.current.get(message.actionId)?.(message);
        return;
    }
  });

  useEffect(() => {
    if (bundleOrigin === null) return;
    const onMessage = (event: MessageEvent) => {
      // Only the embedded guest, from the bundle origin, is trusted.
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== bundleOrigin) {
        return;
      }
      const message = parseGuestMessage(event.data);
      if (message) handleGuestMessage(message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bundleOrigin]);

  /** The pane Run and Insert would go to, frozen at call time. */
  const resolveTarget = useCallback(() => {
    const current = panesRef.current;
    const active = activePaneRef.current ? current.get(activePaneRef.current) : undefined;
    if (active && active.state === "connected") return active;
    // Without a reported focus, only one connected session is unambiguous.
    const connected = [...current.values()].filter((pane) => pane.state === "connected");
    return connected.length === 1 ? connected[0] : undefined;
  }, []);

  const sendAction = useCallback(
    (
      type: "run" | "insert",
      text: string,
      pane: PaneInfo,
      actionId: string,
    ): Promise<WarpGuestMessage | null> =>
      new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          pendingActionsRef.current.delete(actionId);
          resolve(null);
        }, ACTION_ACK_TIMEOUT_MS);
        pendingActionsRef.current.set(actionId, (result) => {
          window.clearTimeout(timer);
          pendingActionsRef.current.delete(actionId);
          resolve(result);
        });
        postToGuest({ type, text, actionId, paneId: pane.paneId });
      }),
    [postToGuest],
  );

  const act = useCallback(
    async (type: "run" | "insert", text: string): Promise<WarpActionOutcome> => {
      const pane = resolveTarget();
      if (!pane) return { ok: false, reason: "no_session", label: null };
      const actionId = randomUUID();
      const admission = admissionRef.current;
      const admitted = admission.admit(
        actionId,
        { paneId: pane.paneId, terminalId: pane.terminalId },
        { terminalId: pane.terminalId, state: pane.state },
      );
      if (!admitted.ok) return { ok: false, reason: admitted.reason, label: pane.label };
      const result = await sendAction(type, text, pane, actionId);
      if (result === null || result.type !== "actionResult") {
        // A lost acknowledgement is UNKNOWN. The same action is never sent again.
        admission.settle(actionId, "unknown");
        return { ok: false, reason: "unknown", label: pane.label };
      }
      admission.settle(actionId, result.ok ? "acknowledged" : "refused");
      if (result.ok) return { ok: true, label: pane.label };
      return {
        ok: false,
        reason:
          result.reason === "busy" ? "busy" : result.reason === "error" ? "error" : "stale_target",
        label: pane.label,
      };
    },
    [resolveTarget, sendAction],
  );

  useEffect(
    () =>
      registerWarpPanel(threadKey, {
        activeTarget: () => {
          const pane = resolveTarget();
          return pane ? { label: pane.label } : null;
        },
        run: (text) => act("run", text),
        insert: (text) => act("insert", text),
      }),
    [act, resolveTarget, threadKey],
  );

  useEffect(() => {
    setVisibleWarpPanel(threadKey, visible);
    return () => setVisibleWarpPanel(threadKey, false);
  }, [threadKey, visible]);

  useEffect(() => {
    if (!visible || bundleOrigin === null) return;
    const paneId = activePaneRef.current;
    if (paneId) postToGuest({ type: "focus", paneId });
    else iframeRef.current?.focus();
  }, [visible, focusRequestId, bundleOrigin, postToGuest]);

  useEffect(() => {
    if (!resizing) setDrawerHeight(height);
  }, [height, resizing]);

  const clampHeight = (value: number) =>
    Math.min(
      Math.max(Math.round(value), MIN_HEIGHT),
      Math.max(MIN_HEIGHT, window.innerHeight * MAX_HEIGHT_RATIO),
    );
  const onResizeDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = { startY: event.clientY, startHeight: drawerHeight };
    setResizing(true);
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (state) setDrawerHeight(clampHeight(state.startHeight + state.startY - event.clientY));
  };
  const onResizeEnd = () => {
    if (!resizeStateRef.current) return;
    resizeStateRef.current = null;
    setResizing(false);
    onHeightChange(drawerHeight);
  };

  const closeSession = async (terminalId: string) => {
    try {
      const access = await readWarpAccess(environmentId);
      if (access === null) return;
      await warpRequest(access, "/close", { method: "POST", body: { threadId, terminalId } });
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not close the Warp session",
          description: error instanceof Error ? error.message : undefined,
        }),
      );
    }
    void refreshSessions();
  };

  const setupMessage =
    bundle.state === "missing"
      ? bundle.message
      : bundle.state === "error"
        ? `Warp is unavailable: ${bundle.message}`
        : null;
  const activePane = activePaneId ? panes.get(activePaneId) : undefined;
  const paneTerminalIds = new Set([...panes.values()].map((pane) => pane.terminalId));
  const detached = serverSessions.filter((session) => !paneTerminalIds.has(session.terminalId));

  return (
    <aside
      data-thread-terminal-drawer
      data-terminal-owner="warp"
      className="relative flex min-w-0 shrink-0 flex-col overflow-hidden border-t border-border/80 bg-background"
      style={{ height: `${drawerHeight}px` }}
    >
      <div
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
      <div
        className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/70 px-2 text-xs"
        data-warp-toolbar
      >
        <span className="rounded bg-muted px-1.5 py-0.5 text-3xs font-medium text-muted-foreground">
          Warp (experimental)
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {[...panes.values()].map((pane) => (
            <div
              key={pane.paneId}
              data-warp-session={pane.label}
              data-warp-terminal-id={pane.terminalId}
              data-warp-state={pane.state}
              className={cn(
                "flex h-5 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-1.5",
                pane.paneId === activePane?.paneId
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <span className={cn("size-1.5 rounded-full", STATE_DOT[pane.state])} />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="cursor-pointer"
                      onClick={() => {
                        setActivePane(pane.paneId);
                        postToGuest({ type: "focus", paneId: pane.paneId });
                      }}
                    />
                  }
                >
                  {pane.label}
                  {pane.state === "exited"
                    ? ` (exited${pane.exitCode === null ? "" : ` ${pane.exitCode}`})`
                    : ""}
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {pane.message ?? `${pane.label}: ${pane.state}`}
                </TooltipPopup>
              </Tooltip>
              <button
                type="button"
                className="cursor-pointer rounded p-0.5 hover:bg-accent"
                aria-label={`Close ${pane.label}`}
                onClick={() => void closeSession(pane.terminalId)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {detached.map((session) => (
            <div
              key={session.terminalId}
              data-warp-detached={session.terminalId}
              className="flex h-5 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-1.5 text-muted-foreground"
            >
              <span className="size-1.5 rounded-full bg-warning" />
              <Tooltip>
                <TooltipTrigger render={<span />}>
                  Detached shell {session.generation ?? ""}
                </TooltipTrigger>
                <TooltipPopup side="top">
                  Still running, but Warp cannot reattach a shell after a reload or a closed pane.
                </TooltipPopup>
              </Tooltip>
              <button
                type="button"
                className="cursor-pointer rounded p-0.5 hover:bg-accent"
                aria-label="Close detached shell"
                onClick={() => void closeSession(session.terminalId)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-black">
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            title="Warp terminal"
            src={iframeSrc}
            // The guest is cross-origin to this app (its own loopback origin), so
            // allow-same-origin only keeps its own wasm fetches same-origin. No top
            // navigation, popups or forms.
            // oxlint-disable-next-line react/iframe-missing-sandbox
            sandbox="allow-scripts allow-same-origin"
            allow="clipboard-read; clipboard-write"
            referrerPolicy="no-referrer"
            className={cn("absolute inset-0 size-full border-0", resizing && "pointer-events-none")}
            onLoad={() => void refreshSessions()}
          />
        ) : (
          <div
            className="flex size-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"
            data-warp-setup={bundle.state}
          >
            {bundle.state === "loading" ? (
              <p>Starting Warp...</p>
            ) : (
              <>
                <p className="max-w-xl">{setupMessage}</p>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
                  onClick={() => void loadBundle()}
                >
                  Check again
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export { describeWarpRefusal };
