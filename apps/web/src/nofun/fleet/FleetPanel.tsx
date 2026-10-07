/**
 * The agents of a thread in the thread details panel: delegated child threads,
 * provider-native subagents and Muse jobs as one list of compact rows (the same
 * rows Lineage uses for forks and parents). Clicking a row opens that agent's
 * conversation inside the Agents sidebar; "Open" opens the sidebar's list.
 */
import type { EnvironmentId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import * as DateTime from "effect/DateTime";
import { useMemo } from "react";

import {
  ThreadRelationshipsPanel,
  type ThreadAgentExtraRow,
} from "../../components/chat/ThreadRelationshipsControl";
import { Button } from "../../components/ui/button";
import { useThreadProjection, useThreadShell } from "../../state/entities";
import { useRightPanelStore } from "../../rightPanelStore";
import { useFleetFocusStore, type FleetFocus } from "./fleetFocus";
import { museRow, phaseRelationshipStatus, subagentRowPhase } from "./fleetModel";
import { useMuseJobs } from "./museJobs";

export function FleetPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const projection = useThreadProjection(ref)?.projection ?? null;
  const shell = useThreadShell(ref);
  const muse = useMuseJobs({
    environmentId: props.environmentId,
    threadId: props.threadId,
    refreshKey: `${shell?.source.itemCount ?? 0}:${shell?.source.status ?? ""}`,
    enabled: true,
  });

  const show = (focus: FleetFocus | null) => {
    useFleetFocusStore.getState().setFocus(ref, focus);
    useRightPanelStore.getState().open(ref, "fleet");
  };

  const extraAgents = useMemo<ReadonlyArray<ThreadAgentExtraRow>>(() => {
    const iso = (value: DateTime.Utc | null) => (value === null ? null : DateTime.formatIso(value));
    const native = (projection?.subagents ?? [])
      .filter((agent) => agent.childThreadId === null)
      .map((agent): ThreadAgentExtraRow => {
        const phase = subagentRowPhase(agent.status);
        return {
          key: agent.id,
          title: formatSubagentDisplayTitle(agent.title ?? agent.prompt.slice(0, 60)),
          driver: agent.driver as ProviderDriverKind,
          status: phaseRelationshipStatus(phase.phase),
          startedAt: iso(agent.startedAt),
          completedAt: iso(agent.completedAt),
          active: phase.active,
          onOpen: null,
        };
      });
    const external = muse.jobs.map(museRow).map((row): ThreadAgentExtraRow => ({
      key: row.key,
      title: row.title,
      status: phaseRelationshipStatus(row.phase),
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      active: row.active,
      onOpen: () => show({ kind: "muse", jobId: row.museJobId ?? row.key }),
    }));
    return [...native, ...external];
  }, [projection?.subagents, muse.jobs, props.environmentId, props.threadId]);

  return (
    <ThreadRelationshipsPanel
      environmentId={props.environmentId}
      threadId={props.threadId}
      view="agents"
      extraAgents={extraAgents}
      onOpenAgent={(childId) => show({ kind: "thread", threadId: childId })}
      agentsActions={
        <Button size="compact" variant="ghost-muted" onClick={() => show(null)}>
          Open
        </Button>
      }
    />
  );
}
