/**
 * Environment every terminal shell starts with so tools and agents inside it
 * know which team, project and thread they belong to. Derived on the server
 * from what the client already sends (`T3CODE_PROJECT_ROOT` and
 * `T3CODE_WORKTREE_PATH`) plus the server's persona scope, so Ghostty and Warp
 * shells get identical values from one place.
 */
import { readNofunPersonaScope } from "../nofun/persona.ts";

export type NofunTeam = "nofun" | "catches";

/** "catches" only for the CATCHES persona; the packaged No Fun app has no persona at all. */
export function nofunTeamFromEnv(env: Readonly<Record<string, string | undefined>>): NofunTeam {
  const id = readNofunPersonaScope(env)?.info.id.toLowerCase();
  return id === "catches" ? "catches" : "nofun";
}

export function terminalContextEnv(input: {
  readonly threadId: string;
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly runtimeEnv: Readonly<Record<string, string>> | null;
  /** The server process environment, which carries the persona scope. */
  readonly serverEnv: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const projectRoot =
    input.runtimeEnv?.T3CODE_PROJECT_ROOT?.trim() || input.worktreePath || input.cwd;
  const worktreePath = input.runtimeEnv?.T3CODE_WORKTREE_PATH?.trim() || input.worktreePath;
  const env: Record<string, string> = {
    NOFUN_TEAM: nofunTeamFromEnv(input.serverEnv),
    T3_PROJECT_NAME: projectRoot.replace(/\/+$/, "").split("/").pop() || projectRoot,
    T3_PROJECT_ROOT: projectRoot,
    T3_THREAD_ID: input.threadId,
  };
  if (worktreePath) env.T3_WORKTREE_PATH = worktreePath;
  return env;
}
