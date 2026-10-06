/**
 * No Fun persona scope for this server process.
 *
 * `scripts/nofun/persona.ts` launches one server per persona and passes the
 * scope through the child environment. Nothing here authenticates anyone; it
 * labels the environment and rejects project roots outside the persona's
 * allowed roots at the project service boundary.
 */
import type { NofunPersonaInfo } from "@t3tools/contracts";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export interface NofunPersonaScope {
  readonly info: NofunPersonaInfo;
  /** Absolute, normalized. Empty means no root restriction. */
  readonly allowedRoots: ReadonlyArray<string>;
}

const expand = (value: string): string =>
  value === "~" || value.startsWith("~/") ? NodePath.join(NodeOS.homedir(), value.slice(1)) : value;

export function readNofunPersonaScope(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NofunPersonaScope | undefined {
  const id = env.T3CODE_PERSONA?.trim();
  if (!id) return undefined;
  const label = env.T3CODE_PERSONA_LABEL?.trim() || id;
  const accent = env.T3CODE_PERSONA_ACCENT?.trim();
  const allowedRoots = (env.T3CODE_PERSONA_ROOTS ?? "")
    .split(NodePath.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => NodePath.resolve(expand(entry)));
  return {
    info: { id, label, ...(accent ? { accent } : {}) },
    allowedRoots,
  };
}

/** Returns an actionable message when `workspaceRoot` is outside the persona's roots. */
export function personaRootViolation(
  scope: NofunPersonaScope | undefined,
  workspaceRoot: string,
): string | undefined {
  if (scope === undefined || scope.allowedRoots.length === 0) return undefined;
  const target = NodePath.resolve(expand(workspaceRoot));
  const inside = scope.allowedRoots.some(
    (root) =>
      target === root ||
      target.startsWith(root.endsWith(NodePath.sep) ? root : root + NodePath.sep),
  );
  if (inside) return undefined;
  return (
    `'${workspaceRoot}' is outside the ${scope.info.label} persona's allowed project roots ` +
    `(${scope.allowedRoots.join(", ")}). Open it in the persona that owns it, or add the root ` +
    `to that persona in ~/.nofun-t3/personas.json and restart.`
  );
}
