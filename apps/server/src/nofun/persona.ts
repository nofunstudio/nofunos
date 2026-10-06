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

export interface NofunPersonaScope {
  readonly info: NofunPersonaInfo;
  /** Absolute, normalized. Empty means no root restriction. */
  readonly allowedRoots: ReadonlyArray<string>;
}

// Roots are absolute posix-style paths (macOS); `..` and `.` segments are folded
// lexically so a persona cannot be escaped with `/allowed/../elsewhere`.
const normalize = (value: string): string => {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
};
const PATH_DELIMITER = ":";

const expand = (value: string): string =>
  normalize(
    value === "~" || value.startsWith("~/") ? `${NodeOS.homedir()}${value.slice(1)}` : value,
  );

export function readNofunPersonaScope(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NofunPersonaScope | undefined {
  const id = env.T3CODE_PERSONA?.trim();
  if (!id) return undefined;
  const label = env.T3CODE_PERSONA_LABEL?.trim() || id;
  const accent = env.T3CODE_PERSONA_ACCENT?.trim();
  const allowedRoots = (env.T3CODE_PERSONA_ROOTS ?? "")
    .split(PATH_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => expand(entry));
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
  const target = expand(workspaceRoot);
  const inside = scope.allowedRoots.some(
    (root) => target === root || target.startsWith(root === "/" ? root : `${root}/`),
  );
  if (inside) return undefined;
  return (
    `'${workspaceRoot}' is outside the ${scope.info.label} persona's allowed project roots ` +
    `(${scope.allowedRoots.join(", ")}). Open it in the persona that owns it, or add the root ` +
    `to that persona in ~/.nofun-t3/personas.json and restart.`
  );
}
