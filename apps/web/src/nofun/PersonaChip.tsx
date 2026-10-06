/**
 * Persona chips: label + accent for every connected environment that was
 * launched for a No Fun persona. Presentational only; a theme never changes
 * a persona, and the chip reads the environment descriptor the server sent.
 */
import { useCallback } from "react";
import {
  NOFUN_BROWSER_PROFILE_HOME_URLS,
  type EnvironmentId,
  type NofunPersonaInfo,
} from "@t3tools/contracts";

import { useServerConfigs } from "~/state/entities";
import { PersonaAvatar, resolvePersonaIdentity } from "./persona";

export function PersonaChip(props: { readonly persona: NofunPersonaInfo }) {
  const identity = resolvePersonaIdentity(props.persona);
  return (
    <span
      data-nofun-persona={identity.label}
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-border bg-background/60 ps-0.5 pe-2 text-3xs font-semibold uppercase tracking-wide text-foreground"
    >
      <PersonaAvatar persona={identity} className="size-4" />
      {identity.label}
    </span>
  );
}

/** One chip per distinct persona among connected environments. */
export function NofunPersonaChips() {
  const configs = useServerConfigs();
  const seen = new Map<string, NofunPersonaInfo>();
  for (const config of configs.values()) {
    const persona = config.environment.persona;
    if (persona !== undefined && !seen.has(persona.id)) seen.set(persona.id, persona);
  }
  if (seen.size === 0) return null;
  return (
    <div className="ml-1 flex items-center gap-1">
      {[...seen.entries()].map(([id, persona]) => (
        <PersonaChip key={id} persona={persona} />
      ))}
    </div>
  );
}

/** "[CATCHES] Mac mini" - used where a thread names its environment. */
export function usePersonaEnvironmentLabeler(): (
  environmentId: EnvironmentId,
  label: string,
) => string {
  const configs = useServerConfigs();
  return useCallback(
    (environmentId, label) => {
      const persona = configs.get(environmentId)?.environment.persona;
      return persona === undefined ? label : `${persona.label} · ${label}`;
    },
    [configs],
  );
}

/** Start page for a persona browser profile, if it has one. */
export function nofunProfileHomeUrl(profileId: string | undefined): string | undefined {
  return profileId === undefined ? undefined : NOFUN_BROWSER_PROFILE_HOME_URLS[profileId];
}
