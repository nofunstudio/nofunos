import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { Plus, X } from "lucide-react";
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
  supportsWarpV2,
  withProtocol,
  WARP_PROTOCOL,
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
/** How long a v2 guest gets to ask for its first pane before the host opens one itself. */
const INITIAL_PANE_GRACE_MS = 3_000;
/** How long Run/Insert wait for a shell they opened themselves to connect and finish bootstrapping. */
const OPEN_SESSION_TIMEOUT_MS = 15_000;
const OPEN_SESSION_POLL_MS = 150;
const FRESH_SHELL_RETRY_MS = 500;

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
  readonly label: string | null;
}

type BundleState =
  | { readonly state: "loading" }
  | {
      readonly state: "ready";
      /** Where the iframe loads from, ending in `/`. */
      readonly base: string;
      readonly origin: string;
      /** Same-origin serving needs no loopback socket; the wave-1 fallback does. */
      readonly sameOrigin: boolean;
    }
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
  /** The right-panel terminal tab this guest belongs to; undefined for the bottom drawer. */
  readonly surfaceId?: string | undefined;
  /** `panel` fills its container (right panel); `drawer` is the resizable bottom drawer. */
  readonly layout?: "drawer" | "panel";
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
  surfaceId,
  layout = "drawer",
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
  const registryKey = surfaceId ? `${threadKey}#${surfaceId}` : threadKey;
  const surfaceQuery = surfaceId ? `&surface=${encodeURIComponent(surfaceId)}` : "";
  const isPanel = layout === "panel";
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [bundle, setBundle] = useState<BundleState>({ state: "loading" });
  const [panes, setPanesState] = useState<ReadonlyMap<string, PaneInfo>>(new Map());
  const panesRef = useRef<ReadonlyMap<string, PaneInfo>>(panes);
  const [activePaneId, setActivePaneState] = useState<string | null>(null);
  const activePaneRef = useRef<string | null>(null);
  const [serverSessions, setServerSessions] = useState<ReadonlyArray<ServerSession>>([]);
  const boundPanesRef = useRef(new Set<string>());
  const labelCountRef = useRef(0);
  // v2 guest state. A guest that never advertises `protocols` is v1: no "+", no re-attach.
  const [guestV2, setGuestV2] = useState(false);
  const guestV2Ref = useRef(false);
  const wireProtocolRef = useRef<string>(WARP_PROTOCOL);
  const guestReadyRef = useRef(false);
  const generationRef = useRef(0);
  const initialPaneHandledRef = useRef(false);
  const reattachPlanRef = useRef<Promise<ReadonlyArray<ServerSession>> | null>(null);
  const reattachQueueRef = useRef<ReadonlyArray<ServerSession>>([]);
  /** `openPane` requests awaiting `paneOpened`. `terminalId` is set for re-attach opens. */
  const pendingOpensRef = useRef(
    new Map<string, { readonly terminalId: string | null; readonly label: string }>(),
  );
  /** Panes the host opened itself, by pane id, with the label they were opened under. */
  const hostOpenedPanesRef = useRef(new Map<string, string>());
  const requestPaneIdsRef = useRef(new Map<string, string>());
  const closedTerminalsRef = useRef(new Set<string>());
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
        | { state: "ready"; mode: "same-origin" | "loopback"; origin: string | null }
        | { state: "missing"; message: string }
      >(access, "/bundle");
      if (status.state !== "ready") {
        setBundle({ state: "missing", message: status.message });
        return;
      }
      // Same-origin: the iframe is served by the T3 server the app is already talking to.
      const sameOrigin = status.mode === "same-origin" || status.origin === null;
      const base = sameOrigin
        ? `${new URL(access.httpBase).origin}/warp-embed/`
        : `${status.origin}/`;
      setBundle({ state: "ready", base, origin: new URL(base).origin, sameOrigin });
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
        `/sessions?threadId=${encodeURIComponent(threadId)}${surfaceQuery}`,
      );
      setServerSessions(result.sessions);
    } catch {
      // The chips fall back to what the guest reported.
    }
  }, [environmentId, surfaceQuery, threadId]);

  const bundleOrigin = bundle.state === "ready" ? bundle.origin : null;
  const bundleBase = bundle.state === "ready" ? bundle.base : null;
  const sameOrigin = bundle.state === "ready" ? bundle.sameOrigin : false;
  const iframeSrc = useMemo(
    () =>
      bundleBase === null
        ? null
        : `${bundleBase}?parentOrigin=${encodeURIComponent(window.location.origin)}`,
    [bundleBase],
  );

  const postToGuest = useCallback(
    (message: { readonly type: string } & Record<string, unknown>) => {
      if (bundleOrigin === null) return;
      iframeRef.current?.contentWindow?.postMessage(
        withProtocol(message, wireProtocolRef.current),
        bundleOrigin,
      );
    },
    [bundleOrigin],
  );

  const nextLabel = useCallback(() => {
    const index = labelCountRef.current++;
    return SESSION_LABELS[index] ?? `Session ${index + 1}`;
  }, []);

  const closeSession = async (terminalId: string, options?: { readonly quiet?: boolean }) => {
    // The guest reports a pane the host just closed, and the shell may already be gone.
    if (closedTerminalsRef.current.has(terminalId)) return;
    closedTerminalsRef.current.add(terminalId);
    try {
      const access = await readWarpAccess(environmentId);
      if (access === null) return;
      await warpRequest(access, "/close", { method: "POST", body: { threadId, terminalId } });
    } catch (error) {
      closedTerminalsRef.current.delete(terminalId);
      if (options?.quiet !== true) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not close the Warp session",
            description: error instanceof Error ? error.message : undefined,
          }),
        );
      }
    }
    if (!guestV2Ref.current) void refreshSessions();
  };

  /** The chip's close button: closes the shell, and with a v2 guest its tab too. */
  const closePane = (pane: PaneInfo) => {
    if (guestV2Ref.current) {
      postToGuest({ type: "closePane", paneId: pane.paneId });
      boundPanesRef.current.delete(pane.paneId);
      setPanes((current) => {
        const next = new Map(current);
        next.delete(pane.paneId);
        return next;
      });
      if (activePaneRef.current === pane.paneId) setActivePane(null);
    }
    void closeSession(pane.terminalId);
  };

  /** Mints a ticket and sends the guest what it needs to connect one pane to one T3 terminal. */
  const mintSession = async (input: {
    readonly terminalId: string;
    readonly label: string;
    readonly reattach: boolean;
  }): Promise<{ readonly terminalId: string; readonly url: string; readonly label: string }> => {
    const access = await readWarpAccess(environmentId);
    if (access === null) throw new Error("Not connected to this environment yet.");
    // The wave-1 loopback bundle is cross-origin, and its guest only allows loopback WebSockets;
    // say so instead of failing silently. Same-origin serving has no such limit.
    if (!sameOrigin && !LOOPBACK_HOSTS.has(new URL(access.wsBase).host.replace(/:\d+$/, ""))) {
      throw new Error(
        "This Warp bundle needs a loopback connection (localhost or 127.0.0.1) to its terminal server. " +
          "Rebuild it with sub-path support to use Warp over a remote connection.",
      );
    }
    const minted = await warpRequest<{ ticket: string }>(access, "/session", {
      method: "POST",
      body: {
        environmentId,
        threadId,
        terminalId: input.terminalId,
        cwd,
        worktreePath: worktreePath ?? null,
        label: input.label,
        reattach: input.reattach,
        ...(surfaceId ? { surface: surfaceId } : {}),
      },
    });
    return {
      terminalId: input.terminalId,
      label: input.label,
      url: `${access.wsBase}/attach?ticket=${encodeURIComponent(minted.ticket)}`,
    };
  };

  const addPane = (paneId: string, terminalId: string, label: string) => {
    boundPanesRef.current.add(paneId);
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
  };

  const failPane = (paneId: string, message: string) => {
    postToGuest({ type: "sessionError", paneId, message });
    setPanes((current) => {
      const pane = current.get(paneId);
      return pane ? new Map(current).set(paneId, { ...pane, state: "error", message }) : current;
    });
  };

  /** Asks a v2 guest for a new, empty Warp shell. Resolves with the request id. */
  const openNewPane = useCallback((): string => {
    const requestId = randomUUID();
    const label = nextLabel();
    pendingOpensRef.current.set(requestId, { terminalId: null, label });
    postToGuest({ type: "openPane", requestId, label });
    return requestId;
  }, [nextLabel, postToGuest]);

  /** Re-opens running shells from before a reload as panes bound straight to them, oldest first. */
  const reopenSessions = async (sessions: ReadonlyArray<ServerSession>, generation: number) => {
    for (const session of sessions) {
      if (generationRef.current !== generation) return;
      const fresh = nextLabel(); // keeps later default names from repeating a restored one
      const label = session.label ?? fresh;
      try {
        const minted = await mintSession({
          terminalId: session.terminalId,
          label,
          reattach: true,
        });
        if (generationRef.current !== generation) return;
        const requestId = randomUUID();
        pendingOpensRef.current.set(requestId, { terminalId: session.terminalId, label });
        postToGuest({
          type: "openPane",
          requestId,
          label,
          session: { terminalId: minted.terminalId, url: minted.url, bootstrap: false },
        });
      } catch {
        // A shell that is gone (closed elsewhere) just does not come back.
      }
    }
  };

  /** Running Warp shells of this surface from before the page loaded; exited ones are cleaned up. */
  const loadReattachPlan = async (): Promise<ReadonlyArray<ServerSession>> => {
    try {
      const access = await readWarpAccess(environmentId);
      if (access === null) return [];
      const result = await warpRequest<{ sessions: ReadonlyArray<ServerSession> }>(
        access,
        `/sessions?threadId=${encodeURIComponent(threadId)}${surfaceQuery}`,
      );
      for (const session of result.sessions) {
        if (session.state === "exited") void closeSession(session.terminalId, { quiet: true });
      }
      return result.sessions.filter((session) => session.state !== "exited");
    } catch {
      return [];
    }
  };

  const bindPane = useEffectEvent(async (paneId: string) => {
    if (boundPanesRef.current.has(paneId)) return;
    boundPanesRef.current.add(paneId);
    // The first pane a v2 guest asks for after `ready` is the one it opened by itself. A
    // running shell from before a reload takes that slot instead of a new shell beside it.
    let revived: ServerSession | null = null;
    if (
      guestV2Ref.current &&
      !initialPaneHandledRef.current &&
      !hostOpenedPanesRef.current.has(paneId)
    ) {
      initialPaneHandledRef.current = true;
      const generation = generationRef.current;
      const queue = (await reattachPlanRef.current) ?? [];
      if (generationRef.current !== generation) return;
      const [first, ...rest] = queue;
      revived = first ?? null;
      reattachQueueRef.current = [];
      if (rest.length > 0) void reopenSessions(rest, generation);
    }
    const fresh = nextLabel();
    const label = revived?.label ?? hostOpenedPanesRef.current.get(paneId) ?? fresh;
    const terminalId = revived?.terminalId ?? randomTerminalId();
    addPane(paneId, terminalId, label);
    try {
      const session = await mintSession({ terminalId, label, reattach: revived !== null });
      postToGuest({ type: "session", paneId, ...session });
    } catch (error) {
      failPane(
        paneId,
        error instanceof WarpRequestError || error instanceof Error
          ? error.message
          : "Could not start a Warp session.",
      );
    }
  });

  const handleGuestMessage = useEffectEvent((message: WarpGuestMessage) => {
    switch (message.type) {
      case "ready": {
        // A new guest instance starts with no panes; anything bound to the previous one
        // is gone. A v1 guest cannot take its shells back (they show up as detached); a
        // v2 guest is handed every running shell of this surface again.
        const generation = ++generationRef.current;
        boundPanesRef.current.clear();
        hostOpenedPanesRef.current.clear();
        pendingOpensRef.current.clear();
        requestPaneIdsRef.current.clear();
        labelCountRef.current = 0;
        initialPaneHandledRef.current = false;
        reattachQueueRef.current = [];
        reattachPlanRef.current = null;
        guestReadyRef.current = true;
        wireProtocolRef.current = message.wireProtocol;
        const v2 = supportsWarpV2(message.protocols);
        guestV2Ref.current = v2;
        setGuestV2(v2);
        setPanes(() => new Map());
        setActivePane(null);
        if (!v2) {
          void refreshSessions();
          return;
        }
        setServerSessions([]);
        const plan = loadReattachPlan();
        reattachPlanRef.current = plan;
        void plan.then((sessions) => {
          window.setTimeout(() => {
            // A guest that does not open a pane of its own would otherwise show an empty workspace.
            if (generationRef.current !== generation || initialPaneHandledRef.current) return;
            initialPaneHandledRef.current = true;
            if (sessions.length > 0) void reopenSessions(sessions, generation);
            else openNewPane();
          }, INITIAL_PANE_GRACE_MS);
        });
        return;
      }
      case "paneOpened": {
        const pending = pendingOpensRef.current.get(message.requestId);
        pendingOpensRef.current.delete(message.requestId);
        if (!pending) return;
        requestPaneIdsRef.current.set(message.requestId, message.paneId);
        if (pending.terminalId !== null) {
          addPane(message.paneId, pending.terminalId, pending.label);
        } else {
          hostOpenedPanesRef.current.set(message.paneId, pending.label);
          // The guest asks for the session right after; keep the name if it already did.
          setPanes((current) => {
            const pane = current.get(message.paneId);
            return pane
              ? new Map(current).set(message.paneId, { ...pane, label: pending.label })
              : current;
          });
        }
        setActivePane(message.paneId);
        postToGuest({ type: "focus", paneId: message.paneId });
        return;
      }
      case "paneClosed": {
        const pane = panesRef.current.get(message.paneId);
        boundPanesRef.current.delete(message.paneId);
        hostOpenedPanesRef.current.delete(message.paneId);
        setPanes((current) => {
          if (!current.has(message.paneId)) return current;
          const next = new Map(current);
          next.delete(message.paneId);
          return next;
        });
        if (activePaneRef.current === message.paneId) setActivePane(null);
        // Closing a Warp tab closes its shell, the same as closing a Ghostty tab.
        const terminalId = message.terminalId ?? pane?.terminalId ?? null;
        if (terminalId !== null) void closeSession(terminalId, { quiet: true });
        return;
      }
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
        if (!guestV2Ref.current) void refreshSessions();
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

  /** Opens a shell for a Run/Insert that has none, then waits until it is connected. */
  const openSessionAndWait = useCallback(async (): Promise<PaneInfo | null> => {
    const requestId = openNewPane();
    const deadline = Date.now() + OPEN_SESSION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const paneId = requestPaneIdsRef.current.get(requestId);
      const pane = paneId ? panesRef.current.get(paneId) : undefined;
      if (pane?.state === "connected") return pane;
      if (pane && (pane.state === "error" || pane.state === "exited")) return null;
      await new Promise((resolve) => window.setTimeout(resolve, OPEN_SESSION_POLL_MS));
    }
    return null;
  }, [openNewPane]);

  const act = useCallback(
    async (type: "run" | "insert", text: string): Promise<WarpActionOutcome> => {
      let pane = resolveTarget();
      // True when the shell was still starting (or opened by this call), so a first refusal
      // from Warp means "not bootstrapped yet" rather than "busy".
      let openedHere = false;
      if (!pane) {
        if (bundleOrigin === null) return { ok: false, reason: "no_session", label: null };
        openedHere = true;
        // A guest that is still loading, or a pane that is still connecting, settles on its own.
        const deadline = Date.now() + OPEN_SESSION_TIMEOUT_MS;
        while (Date.now() < deadline) {
          pane = resolveTarget();
          if (pane) break;
          const settling =
            !guestReadyRef.current ||
            (guestV2Ref.current && !initialPaneHandledRef.current) ||
            [...panesRef.current.values()].some((candidate) => candidate.state === "connecting");
          if (!settling) break;
          await new Promise((resolve) => window.setTimeout(resolve, OPEN_SESSION_POLL_MS));
        }
        if (!pane) {
          // Nothing is usable. A v2 guest can open a shell itself; a v1 guest cannot. Several
          // connected sessions with none focused is ambiguous, never a reason to open another.
          const anyConnected = [...panesRef.current.values()].some(
            (candidate) => candidate.state === "connected",
          );
          if (anyConnected || !guestV2Ref.current || !guestReadyRef.current) {
            return { ok: false, reason: "no_session", label: null };
          }
          const opened = await openSessionAndWait();
          if (!opened) return { ok: false, reason: "opening", label: null };
          pane = opened;
        }
      }
      const admission = admissionRef.current;
      // A shell this call just opened is connected before Warp has finished bootstrapping it.
      // Warp refuses while it is not ready, which guarantees nothing was submitted, so waiting
      // and asking again with a new action id is safe and never duplicates a command.
      const startedAt = Date.now();
      for (;;) {
        const actionId = randomUUID();
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
        if (result.ok) {
          postToGuest({ type: "focus", paneId: pane.paneId });
          return { ok: true, label: pane.label };
        }
        const warming =
          openedHere &&
          (result.reason === "busy" || result.reason === "not_bound") &&
          Date.now() - startedAt < OPEN_SESSION_TIMEOUT_MS;
        if (warming) {
          await new Promise((resolve) => window.setTimeout(resolve, FRESH_SHELL_RETRY_MS));
          const current = panesRef.current.get(pane.paneId);
          if (current === undefined)
            return { ok: false, reason: "stale_target", label: pane.label };
          pane = current;
          continue;
        }
        return {
          ok: false,
          reason:
            result.reason === "busy"
              ? "busy"
              : result.reason === "error"
                ? "error"
                : "stale_target",
          label: pane.label,
        };
      }
    },
    [bundleOrigin, openSessionAndWait, postToGuest, resolveTarget, sendAction],
  );

  useEffect(
    () =>
      registerWarpPanel(registryKey, {
        activeTarget: () => {
          const pane = resolveTarget();
          return pane ? { label: pane.label } : null;
        },
        canOpenSession: () => guestV2Ref.current && guestReadyRef.current,
        run: (text) => act("run", text),
        insert: (text) => act("insert", text),
      }),
    [act, resolveTarget, registryKey],
  );

  useEffect(() => {
    setVisibleWarpPanel(registryKey, visible);
    return () => setVisibleWarpPanel(registryKey, false);
  }, [registryKey, visible]);

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

  const openFromToolbar = () => {
    if (!guestReadyRef.current) return;
    openNewPane();
  };

  const setupMessage =
    bundle.state === "missing"
      ? bundle.message
      : bundle.state === "error"
        ? `Warp is unavailable: ${bundle.message}`
        : null;
  const activePane = activePaneId ? panes.get(activePaneId) : undefined;
  const paneTerminalIds = new Set([...panes.values()].map((pane) => pane.terminalId));
  // Only a v1 guest orphans shells on reload; a v2 guest gets them re-attached instead.
  const detached = guestV2
    ? []
    : serverSessions.filter((session) => !paneTerminalIds.has(session.terminalId));

  return (
    <aside
      data-thread-terminal-drawer
      data-terminal-owner="warp"
      data-warp-layout={layout}
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden bg-background",
        isPanel ? "h-full min-h-0 flex-1" : "shrink-0 border-t border-border/80",
      )}
      style={isPanel ? undefined : { height: `${drawerHeight}px` }}
    >
      {isPanel ? null : (
        <div
          className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
        />
      )}
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
                onClick={() => closePane(pane)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {guestV2 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-warp-new-session
                    className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="New Warp shell"
                    onClick={openFromToolbar}
                  />
                }
              >
                <Plus className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">New Warp shell</TooltipPopup>
            </Tooltip>
          ) : null}
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
            // The guest is first-party code. Served same-origin (/warp-embed/) it shares
            // this app's origin, so the sandbox is only a seatbelt; in the loopback
            // fallback allow-same-origin keeps its own wasm fetches same-origin. No top
            // navigation, popups or forms either way.
            // oxlint-disable-next-line react/iframe-missing-sandbox
            sandbox="allow-scripts allow-same-origin"
            allow="clipboard-read; clipboard-write"
            referrerPolicy="no-referrer"
            className={cn("absolute inset-0 size-full border-0", resizing && "pointer-events-none")}
            onLoad={() => {
              if (!guestV2Ref.current) void refreshSessions();
            }}
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
