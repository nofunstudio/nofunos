/**
 * No Fun personas - which identity a T3 server environment belongs to.
 *
 * A persona is not an authentication mechanism. It labels one running server
 * (its own home dir, provider-instance config dirs, allowed project roots) so
 * clients can show it and so that server can refuse work outside its scope.
 * Selecting a theme or sidebar filter never changes a persona.
 *
 * @module nofunPersona
 */
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const NofunPersonaInfo = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  /** CSS color for the persona chip; purely presentational. */
  accent: Schema.optionalKey(TrimmedNonEmptyString),
});
export type NofunPersonaInfo = typeof NofunPersonaInfo.Type;

/**
 * Persistent browser profiles with a fixed identity. They are built in so a
 * persona's logins cannot be renamed or removed from the picker, and each id
 * maps to its own Electron partition. No cookie import or auth automation:
 * the user signs in once inside the profile.
 */
export const NOFUN_BROWSER_PROFILES: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly kind: "persistent";
}> = [
  { id: "catches-claude-a", name: "CATCHES Claude A", kind: "persistent" },
  { id: "catches-claude-b", name: "CATCHES Claude B", kind: "persistent" },
  { id: "nofun-analytics", name: "No Fun Analytics", kind: "persistent" },
];

/**
 * Where a persona profile opens. Overridable per machine via the persona
 * config; these are the defaults the launcher falls back to.
 */
export const NOFUN_BROWSER_PROFILE_HOME_URLS: Readonly<Record<string, string>> = {
  "catches-claude-a": "https://claude.ai/",
  "catches-claude-b": "https://claude.ai/",
  "nofun-analytics": "https://analytics.getmrch.com/inbox",
};
