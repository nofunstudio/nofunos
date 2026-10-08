/**
 * One agent opened inside the Agents sidebar: a read-only conversation. A child
 * thread renders through the chat view's own MessagesTimeline, subscribed only
 * while this view is mounted. Back returns to the list; the arrow-out icon opens the full thread in the chat.
 */
import type { EnvironmentId, ServerProvider, ThreadId, TurnItemId } from "@t3tools/contracts";
import { turnItemOutputText } from "@t3tools/client-runtime/work-log/item-detail";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  deriveLatestThreadRun,
  deriveRunlessWorkStartedAt,
  deriveThreadRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import type { LegendListRef } from "@legendapp/list/react";
import { ArrowLeftIcon, ArrowUpRightIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { MessagesTimeline } from "../../components/chat/MessagesTimeline";
import { Button } from "../../components/ui/button";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  deriveActiveWorkStartedAt,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  derivePhase,
  type TimelineEntriesProjection,
} from "../../session-logic";
import {
  useServerConfigs,
  useThreadProjection,
  useThreadVisibleTurnItems,
} from "../../state/entities";
import { useTurnItemDetail } from "../../state/queries";
import { FleetAvatar } from "./FleetAvatar";
import { PHASE_LABEL, type FleetPhase } from "./fleetModel";
import type { BackgroundRow } from "./backgroundModel";

const EMPTY_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const noop = () => {};
const noopAsync = async () => {};

export interface AgentHeader {
  readonly title: string;
  readonly driver: string;
  readonly phase: FleetPhase;
  /** "Codex · gpt-6-luna · high" */
  readonly detail: string;
}

export function AgentViewHeader(props: {
  readonly header: AgentHeader;
  readonly onBack: () => void;
  readonly onOpenFull?: (() => void) | undefined;
  readonly onRefresh?: (() => void) | undefined;
}) {
  const { header } = props;
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1.5">
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label="Back to agents"
        onClick={props.onBack}
      >
        <ArrowLeftIcon className="size-3.5" />
      </Button>
      <FleetAvatar driver={header.driver} phase={header.phase} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground/90">{header.title}</span>
        <span className="truncate text-2xs text-muted-foreground">
          {header.detail} · {PHASE_LABEL[header.phase]}
        </span>
      </div>
      {props.onRefresh ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Refresh log"
          onClick={props.onRefresh}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      ) : null}
      {props.onOpenFull ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Open full thread"
          onClick={props.onOpenFull}
        >
          <ArrowUpRightIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export function describeAgent(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}

/** The child thread's conversation, read-only, live while it runs. */
export function AgentConversation(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { environmentId, threadId } = props;
  const ref = useMemo(() => scopeThreadRef(environmentId, threadId), [environmentId, threadId]);
  const projection = useThreadProjection(ref)?.projection ?? null;
  const visibleItems = useThreadVisibleTurnItems(ref);
  const providers = useServerConfigs().get(environmentId)?.providers ?? EMPTY_PROVIDERS;
  const settings = useEnvironmentSettings(environmentId);
  const { resolvedTheme } = useTheme();
  const listRef = useRef<LegendListRef | null>(null);
  const previous = useRef<TimelineEntriesProjection | null>(null);

  const entries = useMemo(() => {
    const next = deriveTimelineEntriesFromVisibleTurnItemsWithState(
      {
        visibleTurnItems: visibleItems,
        optimisticMessages: [],
        ...(projection === null
          ? {}
          : { attempts: projection.attempts, nodes: projection.nodes, plans: projection.plans }),
      },
      previous.current,
    );
    previous.current = next;
    return next.entries;
  }, [visibleItems, projection]);

  const runtime = useMemo(
    () => (projection === null ? null : deriveThreadRuntime(projection)),
    [projection],
  );
  const latestRun = useMemo(
    () => (projection === null ? null : deriveLatestThreadRun(projection)),
    [projection],
  );
  const runlessStartedAt = useMemo(
    () => (projection === null ? null : deriveRunlessWorkStartedAt(projection)),
    [projection],
  );
  const working = derivePhase(runtime) === "running" || runlessStartedAt !== null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background" data-fleet-agent-thread>
      <MessagesTimeline
        isWorking={working}
        runlessWorkActive={runlessStartedAt !== null}
        activeTurnInProgress={working}
        activeTurnStartedAt={
          deriveActiveWorkStartedAt(latestRun, runtime, null) ?? runlessStartedAt
        }
        listRef={listRef}
        timelineEntries={entries}
        latestRun={latestRun}
        runningRunId={runtime?.activeRunId ?? null}
        turnDiffSummaries={[]}
        routeThreadKey={scopedThreadKey(ref)}
        onOpenTurnDiff={noop}
        onOpenThread={props.onOpenThread}
        onForkFromRun={noopAsync}
        onRollbackCheckpoint={noop}
        supportsConversationRollback={false}
        onRevertToTurnCount={noop}
        isRevertingCheckpoint={false}
        onImageExpand={noop}
        activeThreadEnvironmentId={environmentId}
        markdownCwd={undefined}
        resolvedTheme={resolvedTheme}
        timestampFormat={settings.timestampFormat}
        workspaceRoot={undefined}
        providerStatuses={providers}
        runs={projection?.runs ?? []}
        anchorMessageId={null}
        onAnchorReady={noop}
        onAnchorSizeChanged={noop}
        contentInsetEndAdjustment={0}
        onIsAtEndChange={noop}
        liveFollowEnabled
        onManualNavigation={noop}
      />
    </div>
  );
}

export function formatAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

/** A background task's latest output; the projection pushes updates while it runs. */
export function BackgroundOutputView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly row: BackgroundRow | null;
}) {
  const { row } = props;
  const detail = useTurnItemDetail(
    row?.outputOmitted && row.itemId && row.revision
      ? {
          environmentId: props.environmentId,
          threadId: props.threadId,
          itemId: row.itemId as TurnItemId,
          revision: row.revision,
        }
      : null,
  );
  const fetched = detail.data?.item;
  const fetchedText = fetched ? turnItemOutputText(fetched) : null;
  const lines = row?.output ?? (fetchedText ? fetchedText.split("\n").slice(-200) : null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3"
      data-fleet-bg-output
    >
      {row === null ? (
        <p className="text-xs text-muted-foreground">This task has finished.</p>
      ) : (
        <>
          {row.command && row.command !== row.label ? (
            <p className="mb-2 break-words font-mono text-2xs text-muted-foreground">
              $ {row.command}
            </p>
          ) : null}
          {lines ? (
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-foreground/80">
              {lines.join("\n")}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">
              {row.outputOmitted && detail.isPending ? "Loading output." : "No output yet."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
