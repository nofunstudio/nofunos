/**
 * Persona identity for the UI: which world (No Fun or CATCHES) an environment
 * belongs to, and the icon that says so at a glance. A server launched without
 * a persona is No Fun. Presentational only; the server owns persona scope.
 */
import type { EnvironmentId, NofunPersonaInfo } from "@t3tools/contracts";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import { useServerConfigs } from "~/state/entities";

export type PersonaTone = "dark" | "light";

export interface PersonaIdentity {
  readonly id: string;
  readonly label: string;
  /** Glossy black squircle (No Fun) or its white inverse (CATCHES). */
  readonly tone: PersonaTone;
  readonly src: string;
  readonly accent: string | undefined;
  /** False for the default No Fun world, so banners only call out the other one. */
  readonly isAlternate: boolean;
}

const ICONS: Readonly<Record<string, { readonly src: string; readonly tone: PersonaTone }>> = {
  nofun: { src: "/nofun/persona-nofun-128.png", tone: "dark" },
  catches: { src: "/nofun/persona-catches-128.png", tone: "light" },
};

export const NOFUN_PERSONA: PersonaIdentity = {
  id: "nofun",
  label: "No Fun",
  tone: "dark",
  src: ICONS.nofun!.src,
  accent: undefined,
  isAlternate: false,
};

export function resolvePersonaIdentity(persona: NofunPersonaInfo | undefined): PersonaIdentity {
  if (persona === undefined) return NOFUN_PERSONA;
  const icon = ICONS[persona.icon ?? persona.id] ?? ICONS[persona.id] ?? ICONS.nofun!;
  return {
    id: persona.id,
    label: persona.label,
    tone: icon.tone,
    src: icon.src,
    accent: persona.accent,
    isAlternate: persona.id !== "nofun",
  };
}

/** Persona of one environment; No Fun while the config is unknown or has none. */
export function usePersonaIdentity(
  environmentId: EnvironmentId | null | undefined,
): PersonaIdentity {
  const configs = useServerConfigs();
  const persona =
    environmentId === null || environmentId === undefined
      ? undefined
      : configs.get(environmentId)?.environment.persona;
  return useMemo(() => resolvePersonaIdentity(persona), [persona]);
}

/** True once connected environments span more than one persona world. */
export function useSpansPersonas(): boolean {
  const configs = useServerConfigs();
  const ids = new Set<string>();
  for (const config of configs.values()) ids.add(config.environment.persona?.id ?? "nofun");
  return ids.size > 1;
}

/**
 * The persona's app-icon squircle. The image carries its own rounded corners and
 * edge, so it needs no radius or ring. Size it with a `size-*` class.
 */
export function PersonaAvatar(props: {
  readonly persona: PersonaIdentity;
  readonly className?: string | undefined;
  readonly decorative?: boolean;
}) {
  return (
    <img
      src={props.persona.src}
      alt={props.decorative === false ? props.persona.label : ""}
      aria-hidden={props.decorative === false ? undefined : true}
      draggable={false}
      data-nofun-persona-avatar={props.persona.id}
      className={cn("inline-block size-4 shrink-0 select-none object-cover", props.className)}
    />
  );
}

/** Avatar for an environment id, for rows that only know where they live. */
export function EnvironmentPersonaAvatar(props: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly className?: string | undefined;
}) {
  const persona = usePersonaIdentity(props.environmentId);
  return <PersonaAvatar persona={persona} className={props.className} />;
}

// The app icons' glossy squircles, as SVG gradients: lit black, or its white inverse.
const monogramPaint: Record<PersonaTone, { top: string; bottom: string; text: string }> = {
  dark: { top: "#5c5c5c", bottom: "#050505", text: "#ffffff" },
  light: { top: "#ffffff", bottom: "#dedede", text: "#0a0a0a" },
};

/**
 * A project's generated monogram drawn on its persona's squircle, used when the
 * project has no icon of its own: black tiles are No Fun, white tiles CATCHES.
 */
export function PersonaMonogram(props: {
  readonly persona: PersonaIdentity;
  readonly text: string;
  readonly className?: string | undefined;
}) {
  const paint = monogramPaint[props.persona.tone];
  const gradientId = `nofun-monogram-${props.persona.tone}`;
  return (
    // Wrapped like ProjectMonogram so it sits where an <img> favicon would.
    <span
      aria-hidden="true"
      data-nofun-persona-monogram={props.persona.id}
      className={cn("inline-flex size-4 shrink-0 items-center justify-center", props.className)}
    >
      <svg viewBox="0 0 16 16" className="size-full select-none font-mono">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={paint.top} />
            <stop offset="1" stopColor={paint.bottom} />
          </linearGradient>
        </defs>
        <rect
          x="0.5"
          y="0.5"
          width="15"
          height="15"
          rx="4"
          fill={`url(#${gradientId})`}
          className="stroke-border"
          strokeWidth="1"
        />
        <text
          x="8"
          y="10.6"
          textAnchor="middle"
          fill={paint.text}
          fontSize="7.25"
          fontWeight="700"
          textLength={Array.from(props.text).length === 1 ? 5 : 10}
          lengthAdjust="spacingAndGlyphs"
          textRendering="geometricPrecision"
        >
          {props.text}
        </text>
      </svg>
    </span>
  );
}
