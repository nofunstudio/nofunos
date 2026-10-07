/**
 * The Fleet sidebar: every agent working for this thread, live.
 *
 * Reads only the v2 projection (`subagents`, child thread shells, a child's
 * latest provider turn) plus Muse job summaries. No store of its own, no
 * polling; the only timer is the 1 Hz elapsed tick of a running row. A child's
 * projection is subscribed only while its row is active or its Done group is
 * open. Stopping is an explicit per-row action.
 */
import type {
  EnvironmentId,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadShell,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { formatTokens } from "@t3tools/shared/usageFormat";
import { useNavigate } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import { ChevronRightIcon, SquareIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { AgentElapsed } from "../../components/chat/AgentElapsed";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import {
  useServerConfigs,
  useThreadProjection,
  useThreadShell,
  useThreadShells,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { FleetAvatar } from "./FleetAvatar";
import {
  AgentConversation,
  AgentViewHeader,
  MuseJobLogView,
  describeAgent,
  type AgentHeader,
} from "./FleetAgentView";
import { useFleetFocus, useFleetFocusStore } from "./fleetFocus";
import {
  PHASE_LABEL,
  defaultEffortFor,
  driverName,
  museRow,
  resolveEffort,
  shortModelName,
  splitFleetRows,
  subagentRow,
  subagentRowPhase,
  type FleetRow,
} from "./fleetModel";
import { useMuseJobs } from "./museJobs";

const MAX_DEPTH = 3;
const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

type Shells = ReadonlyMap<string, OrchestrationV2ThreadShell>;

const iso = (value: DateTime.Utc | null): string | null =>
  value === null ? null : DateTime.formatIso(value);

function latestTokens(projection: {
  readonly providerTurns: ReadonlyArray<{
    readonly tokenUsage?: { readonly usedTokens: number } | undefined;
  }>;
}): number | null {
  const turns = projection.providerTurns;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const usage = turns[index]?.tokenUsage;
    if (usage !== undefined) return usage.usedTokens;
  }
  return null;
}

function FleetRowView(props: {
  readonly row: FleetRow;
  readonly onOpen: (() => void) | null;
  readonly onStop: (() => void) | null;
}) {
  const { row } = props;
  const model = shortModelName(row.model);
  const what = [driverName(row.driver), model, row.effort].filter(Boolean).join(" · ");
  return (
    <div
      className="group/fleet-row flex min-w-0 items-start gap-2.5 rounded-lg py-1.5 pr-1 hover:bg-accent/50"
      style={{ paddingLeft: `${row.depth * 14 + 6}px` }}
      data-fleet-row={row.key}
      data-fleet-phase={row.phase}
    >
      <FleetAvatar driver={row.driver} phase={row.phase} />
      <button
        type="button"
        disabled={props.onOpen === null}
        onClick={props.onOpen ?? undefined}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground/90">
            {row.title}
          </span>
          <span
            className={cn(
              "shrink-0 text-2xs",
              row.phase === "failed"
                ? "text-destructive-foreground"
                : row.phase === "waiting"
                  ? "text-warning-foreground"
                  : "text-muted-foreground",
            )}
          >
            {PHASE_LABEL[row.phase]}
          </span>
        </span>
        <span className="min-w-0 truncate text-2xs text-muted-foreground">{what}</span>
        <span className="flex min-w-0 items-center gap-1 truncate text-2xs text-muted-foreground/80">
          <span className="truncate">{row.origin}</span>
          {row.tokens !== null ? (
            <span className="shrink-0">· {formatTokens(row.tokens)} tok</span>
          ) : null}
          {row.startedAt !== null ? (
            <span className="shrink-0">
              ·{" "}
              <AgentElapsed
                agent={{
                  status: row.active ? "running" : "completed",
                  startedAt: row.startedAt,
                  completedAt: row.completedAt,
                }}
              />
            </span>
          ) : null}
        </span>
      </button>
      {row.active && props.onStop ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`Stop ${row.title}`}
          onClick={props.onStop}
        >
          <SquareIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

/** One projected subagent, its live child usage, and its own children beneath it. */
function SubagentBranch(props: {
  readonly environmentId: EnvironmentId;
  readonly agent: OrchestrationV2Subagent;
  readonly shells: Shells;
  readonly depth: number;
  readonly live: boolean;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const { agent, environmentId } = props;
  const stopTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const providers = useServerConfigs().get(environmentId)?.providers;
  const childId = agent.childThreadId;
  const childShell = childId ? props.shells.get(childId) : undefined;
  const active =
    agent.status === "pending" || agent.status === "running" || agent.status === "waiting";
  const subscribed = childId !== null && (props.live || active);
  const projection =
    useThreadProjection(subscribed ? scopeThreadRef(environmentId, childId) : null)?.projection ??
    null;
  const row = subagentRow({
    agent,
    displayTitle: formatSubagentDisplayTitle(
      agent.title ?? childShell?.title ?? agent.prompt.slice(0, 60),
    ),
    childSelection: childShell?.modelSelection,
    tokens: projection ? latestTokens(projection) : null,
    defaultEffort: defaultEffortFor(
      providers,
      agent.providerInstanceId,
      agent.model ?? childShell?.modelSelection?.model ?? null,
    ),
    depth: props.depth,
    startedAt: iso(agent.startedAt),
    completedAt: iso(agent.completedAt),
  });
  const nested = props.depth < MAX_DEPTH ? (projection?.subagents ?? []) : [];
  return (
    <>
      <FleetRowView
        row={row}
        onOpen={childId ? () => props.onOpenThread(childId) : null}
        onStop={
          childId ? () => void stopTurn({ environmentId, input: { threadId: childId } }) : null
        }
      />
      {nested.map((child) => (
        <SubagentBranch
          key={child.id}
          environmentId={environmentId}
          agent={child}
          shells={props.shells}
          depth={props.depth + 1}
          live={props.live}
          onOpenThread={props.onOpenThread}
        />
      ))}
    </>
  );
}

type MuseJobs = ReturnType<typeof useMuseJobs>;

function FleetList(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shells: Shells;
  readonly muse: MuseJobs;
}) {
  const { environmentId, threadId, shells, muse } = props;
  const ref = scopeThreadRef(environmentId, threadId);
  const projection = useThreadProjection(ref)?.projection ?? null;
  const [doneOpen, setDoneOpen] = useState(false);

  const agents = useMemo(() => projection?.subagents ?? [], [projection?.subagents]);
  const activeAgents = agents.filter((agent) =>
    ["pending", "running", "waiting"].includes(agent.status),
  );
  const doneAgents = agents
    .filter((agent) => !activeAgents.includes(agent))
    .toSorted(
      (a, b) =>
        DateTime.toEpochMillis(b.completedAt ?? b.updatedAt) -
        DateTime.toEpochMillis(a.completedAt ?? a.updatedAt),
    );
  const museRows = useMemo(() => splitFleetRows(muse.jobs.map(museRow)), [muse.jobs]);
  const activeCount = activeAgents.length + museRows.active.length;
  const doneCount = doneAgents.length + museRows.settled.length;

  const setFocus = useFleetFocusStore((state) => state.setFocus);
  const openThread = (id: ThreadId) => setFocus(ref, { kind: "thread", threadId: id });

  const branch = (agent: OrchestrationV2Subagent, live: boolean) => (
    <SubagentBranch
      key={agent.id}
      environmentId={environmentId}
      agent={agent}
      shells={shells}
      depth={0}
      live={live}
      onOpenThread={openThread}
    />
  );

  return (
    <>
      <div className="flex min-h-8 items-center px-3.5 text-2xs text-muted-foreground tabular-nums">
        {activeCount > 0 ? `${activeCount} active` : "\u00a0"}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {activeCount === 0 && doneCount === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No agents yet. They show up here when this thread delegates work.
          </p>
        ) : null}
        {activeAgents.map((agent) => branch(agent, true))}
        {museRows.active.map((row) => (
          <FleetRowView
            key={row.key}
            row={row}
            onOpen={() => setFocus(ref, { kind: "muse", jobId: row.museJobId ?? row.key })}
            onStop={row.museJobId ? () => void muse.cancel(row.museJobId!) : null}
          />
        ))}
        {doneCount > 0 ? (
          <div className="mt-1.5">
            <button
              type="button"
              aria-expanded={doneOpen}
              onClick={() => setDoneOpen((open) => !open)}
              className="flex w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRightIcon
                className={cn("size-3 transition-transform", doneOpen && "rotate-90")}
              />
              Done ({doneCount})
            </button>
            {doneOpen ? (
              <>
                {doneAgents.map((agent) => branch(agent, true))}
                {museRows.settled.map((row) => (
                  <FleetRowView
                    key={row.key}
                    row={row}
                    onOpen={() => setFocus(ref, { kind: "muse", jobId: row.museJobId ?? row.key })}
                    onStop={null}
                  />
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

/** One agent's header facts, from the parent's agent record and the child's shell. */
function threadAgentHeader(input: {
  readonly agent: OrchestrationV2Subagent | undefined;
  readonly shell: OrchestrationV2ThreadShell | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
}): AgentHeader {
  const { agent, shell, providers } = input;
  const instanceId = agent?.providerInstanceId ?? shell?.providerInstanceId ?? "";
  const provider = providers.find((candidate) => candidate.instanceId === instanceId);
  const driver = agent?.driver ?? provider?.driver ?? "claudeAgent";
  const model = shortModelName(agent?.model ?? shell?.modelSelection?.model ?? null);
  const effort =
    resolveEffort(shell?.modelSelection) ?? defaultEffortFor(providers, instanceId, model);
  const live = shell?.activityRunStatus;
  const phase =
    live === "running" || live === "waiting"
      ? live
      : agent
        ? subagentRowPhase(agent.status).phase
        : "done";
  return {
    title: formatSubagentDisplayTitle(agent?.title ?? shell?.title ?? "Agent"),
    driver,
    phase,
    detail: describeAgent([driverName(driver), model, effort]),
  };
}

function FleetDetail(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shells: Shells;
  readonly muse: MuseJobs;
  readonly parentRefreshKey: string;
}) {
  const { environmentId, threadId } = props;
  const navigate = useNavigate();
  const ref = scopeThreadRef(environmentId, threadId);
  const focus = useFleetFocus(ref);
  const setFocus = useFleetFocusStore((state) => state.setFocus);
  const projection = useThreadProjection(ref)?.projection ?? null;
  const providers = useServerConfigs().get(environmentId)?.providers ?? NO_PROVIDERS;
  const back = () => setFocus(ref, null);
  if (focus === null) return null;

  if (focus.kind === "muse") {
    const job = props.muse.jobs.find((candidate) => candidate.jobId === focus.jobId);
    const row = job ? museRow(job) : null;
    const header: AgentHeader = {
      title: row?.title ?? "Muse job",
      driver: "muse",
      phase: row?.phase ?? "done",
      detail: describeAgent(["Muse", shortModelName(row?.model ?? null)]),
    };
    return (
      <MuseJobLogView
        environmentId={environmentId}
        jobId={focus.jobId}
        refreshKey={props.parentRefreshKey}
        header={header}
        onBack={back}
      />
    );
  }

  const childId = focus.threadId as ThreadId;
  const header = threadAgentHeader({
    agent: projection?.subagents.find((candidate) => candidate.childThreadId === childId),
    shell: props.shells.get(childId),
    providers,
  });
  const openFull = () =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, childId)),
    });
  return (
    <>
      <AgentViewHeader header={header} onBack={back} onOpenFull={openFull} />
      <AgentConversation
        key={childId}
        environmentId={environmentId}
        threadId={childId}
        onOpenThread={(id) => setFocus(ref, { kind: "thread", threadId: id })}
      />
    </>
  );
}

export function FleetSidebar(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { environmentId, threadId } = props;
  const ref = scopeThreadRef(environmentId, threadId);
  const parentShell = useThreadShell(ref);
  const focus = useFleetFocus(ref);
  const allShells = useThreadShells();
  const shells = useMemo<Shells>(
    () =>
      new Map(
        allShells
          .filter((thread) => thread.environmentId === environmentId)
          .map((thread) => [thread.source.id as string, thread.source] as const),
      ),
    [allShells, environmentId],
  );
  const parentRefreshKey = `${parentShell?.source.itemCount ?? 0}:${parentShell?.source.status ?? ""}`;
  const muse = useMuseJobs({
    environmentId,
    threadId,
    refreshKey: parentRefreshKey,
    enabled: true,
  });
  return (
    <div className="flex h-full min-h-0 flex-col" data-nofun-fleet-sidebar>
      {focus === null ? (
        <FleetList environmentId={environmentId} threadId={threadId} shells={shells} muse={muse} />
      ) : (
        <FleetDetail
          environmentId={environmentId}
          threadId={threadId}
          shells={shells}
          muse={muse}
          parentRefreshKey={parentRefreshKey}
        />
      )}
    </div>
  );
}
