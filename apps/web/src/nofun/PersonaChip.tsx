/**
 * Persona chips: label + accent for every connected environment that was
 * launched for a No Fun persona. Presentational only; a theme never changes
 * a persona, and the chip reads the environment descriptor the server sent.
 */
import { useCallback } from "react";
import { NOFUN_BROWSER_PROFILE_HOME_URLS, type EnvironmentId } from "@t3tools/contracts";

import { useServerConfigs } from "~/state/entities";

export function PersonaChip(props: {
  readonly label: string;
  readonly accent?: string | undefined;
}) {
  return (
    <span
      data-nofun-persona={props.label}
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-current/25 px-2 text-[10px] font-semibold uppercase tracking-wide"
      style={props.accent ? { color: props.accent } : undefined}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {props.label}
    </span>
  );
}

/** One chip per distinct persona among connected environments. */
export function NofunPersonaChips() {
  const configs = useServerConfigs();
  const seen = new Map<string, { label: string; accent?: string | undefined }>();
  for (const config of configs.values()) {
    const persona = config.environment.persona;
    if (persona !== undefined && !seen.has(persona.id)) seen.set(persona.id, persona);
  }
  if (seen.size === 0) return null;
  return (
    <div className="ml-1 flex items-center gap-1">
      {[...seen.entries()].map(([id, persona]) => (
        <PersonaChip key={id} label={persona.label} accent={persona.accent} />
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
