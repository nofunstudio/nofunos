/**
 * The thread details entry for the Fleet: one quiet line that opens the Agents
 * sidebar. The sidebar (FleetSidebar) is the only place agents are listed.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { ThreadDetailsSection } from "../../components/chat/ThreadDetailsSection";
import { Button } from "../../components/ui/button";
import { useThreadProjection } from "../../state/entities";
import { useRightPanelStore } from "../../rightPanelStore";

export function FleetPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const subagents = useThreadProjection(ref)?.projection?.subagents ?? [];
  if (subagents.length === 0) return null;
  const running = subagents.filter((agent) =>
    ["pending", "running", "waiting"].includes(agent.status),
  ).length;
  return (
    <ThreadDetailsSection
      headingId="nofun-fleet-heading"
      title={running > 0 ? `Agents · ${running} active` : `Agents · ${subagents.length}`}
      data-nofun-fleet-panel
      actions={
        <Button
          size="compact"
          variant="ghost-muted"
          onClick={() => useRightPanelStore.getState().open(ref, "fleet")}
        >
          Open
        </Button>
      }
    >
      {null}
    </ThreadDetailsSection>
  );
}
