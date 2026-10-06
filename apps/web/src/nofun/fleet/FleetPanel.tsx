/**
 * No Fun "Fleet": what this thread's delegated children are actually doing.
 *
 * Reads only the authoritative v2 thread projection (`subagents`) and the
 * child thread shells. No second store, no polling, no model-written status.
 * Closing the panel never cancels anything; Stop is an explicit per-row action
 * that interrupts the child thread's turn through the existing command.
 */
import type {
  EnvironmentId,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { SquareIcon } from "lucide-react";
import { useMemo } from "react";

import { ThreadDetailsSection } from "../../components/chat/ThreadDetailsSection";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { MiddleTruncate } from "../../components/ui/middle-truncate";
import { useThreadProjection, useThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

type Subagent = OrchestrationV2Subagent;
type BadgeVariant = "info" | "warning" | "success" | "error" | "secondary";

const STATUS_PRESENTATION: Record<
  Subagent["status"],
  { readonly label: string; readonly variant: BadgeVariant; readonly active: boolean }
> = {
  pending: { label: "Queued", variant: "secondary", active: true },
  running: { label: "Running", variant: "info", active: true },
  waiting: { label: "Pending input", variant: "warning", active: true },
  idle: { label: "Idle", variant: "secondary", active: false },
  // "Result available" is the child's own claim. Root verification is not
  // tracked yet, so no verified badge is rendered anywhere.
  completed: { label: "Result available", variant: "success", active: false },
  failed: { label: "Failed", variant: "error", active: false },
  cancelled: { label: "Cancelled", variant: "secondary", active: false },
  interrupted: { label: "Interrupted", variant: "secondary", active: false },
};

/**
 * TODO(nofun/muse): external workers (Muse jobs) are not part of the thread
 * projection. Once the server exposes them (MCP toolkit `muse_task_status`),
 * return their rows here. Returning an empty list renders no group, so nothing
 * is faked in the meantime.
 */
function useExternalWorkers(): ReadonlyArray<never> {
  return [];
}

function workspaceLabel(
  parent: Pick<OrchestrationV2ThreadShell, "worktreePath"> | undefined,
  child: Pick<OrchestrationV2ThreadShell, "worktreePath" | "branch"> | undefined,
): { readonly kind: string; readonly value: string | null } {
  if (!child) return { kind: "Workspace unknown", value: null };
  if (child.worktreePath && child.worktreePath !== parent?.worktreePath) {
    return { kind: "Worktree", value: child.branch ?? child.worktreePath };
  }
  return { kind: "Inherits workspace", value: null };
}

function FleetRow(props: {
  readonly environmentId: EnvironmentId;
  readonly agent: Subagent;
  readonly parent: OrchestrationV2ThreadShell | undefined;
  readonly child: OrchestrationV2ThreadShell | undefined;
}) {
  const { agent, child } = props;
  const stopTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const status = STATUS_PRESENTATION[agent.status];
  const selection = child?.modelSelection;
  const effort = ["reasoningEffort", "effort", "reasoning", "variant"]
    .map((id) => getModelSelectionStringOptionValue(selection, id))
    .find(Boolean);
  const model = agent.model ?? selection?.model ?? "model not reported";
  const workspace = workspaceLabel(props.parent, child);
  const title = formatSubagentDisplayTitle(
    agent.title ?? child?.title ?? agent.prompt.slice(0, 60),
  );
  const childThreadId = agent.childThreadId;
  return (
    <li className="flex min-w-0 flex-col gap-0.5 rounded-lg px-1.5 py-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground/85">{title}</span>
        <span className="flex shrink-0 items-center gap-1">
          {status.active && childThreadId ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Stop ${title}`}
              onClick={() =>
                void stopTurn({
                  environmentId: props.environmentId,
                  input: { threadId: childThreadId },
                })
              }
            >
              <SquareIcon className="size-3" />
            </Button>
          ) : null}
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        </span>
      </div>
      <div className="min-w-0 truncate text-2xs text-muted-foreground">
        {agent.driver} · {agent.providerInstanceId} · {model}
        {effort ? ` · ${effort}` : ""}
      </div>
      <div className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
        <span className="shrink-0">{workspace.kind}</span>
        {workspace.value ? <MiddleTruncate value={workspace.value} className="flex" /> : null}
        <span className="shrink-0">
          · {agent.origin === "app_owned" ? "T3-owned" : "provider-native"}
        </span>
      </div>
    </li>
  );
}

export function FleetPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const projection = useThreadProjection(ref)?.projection ?? null;
  const shells = useThreadShells();
  const externalWorkers = useExternalWorkers();
  const shellById = useMemo(
    () =>
      new Map(
        shells
          .filter((thread) => thread.environmentId === props.environmentId)
          .map((thread) => [thread.source.id, thread.source] as const),
      ),
    [shells, props.environmentId],
  );
  const agents = projection?.subagents ?? [];
  if (agents.length === 0 && externalWorkers.length === 0) return null;
  const parent = shellById.get(props.threadId);
  const running = agents.filter((agent) => STATUS_PRESENTATION[agent.status].active).length;
  return (
    <ThreadDetailsSection
      headingId="nofun-fleet-heading"
      title={running > 0 ? `Fleet · ${running} active` : "Fleet"}
      data-nofun-fleet-panel
    >
      <ul aria-label="Delegated agents" className="m-0 list-none p-0">
        {agents.map((agent) => (
          <FleetRow
            key={agent.id}
            environmentId={props.environmentId}
            agent={agent}
            parent={parent}
            child={agent.childThreadId ? shellById.get(agent.childThreadId) : undefined}
          />
        ))}
      </ul>
    </ThreadDetailsSection>
  );
}
