import type { EnvironmentId } from "@t3tools/contracts";
import { GitBranch } from "lucide-react";

import { PersonaAvatar, usePersonaIdentity } from "~/nofun/persona";

/** Last path segment, tolerant of a trailing slash. */
export const pathBasename = (path: string): string =>
  path.replace(/\/+$/, "").split("/").pop() || path;

/**
 * One quiet line for the terminal header: which team this environment belongs to
 * (No Fun or CATCHES), then the project and the thread's branch. The same values
 * are exported to every shell as NOFUN_TEAM, T3_PROJECT_NAME and friends.
 */
export function TeamProjectLine(props: {
  readonly environmentId: EnvironmentId;
  readonly projectName: string;
  readonly branch: string | null;
}) {
  const persona = usePersonaIdentity(props.environmentId);
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      data-terminal-context
      data-nofun-team={persona.id}
    >
      <PersonaAvatar persona={persona} className="size-3.5" />
      <span className="shrink-0 font-medium text-foreground">{persona.label}</span>
      <span aria-hidden>·</span>
      <span className="truncate">{props.projectName}</span>
      {props.branch ? (
        <>
          <span aria-hidden>·</span>
          <GitBranch className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{props.branch}</span>
        </>
      ) : null}
    </div>
  );
}
