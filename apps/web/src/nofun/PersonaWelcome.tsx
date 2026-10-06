/**
 * The No Fun new-thread welcome: who you are working as, and a few starters
 * that exercise No Fun features. Text stays primary; these only seed the prompt.
 */
import { LayoutDashboardIcon, LayersIcon, UsersIcon } from "lucide-react";
import type { ComponentType } from "react";

import { Button } from "~/components/ui/button";
import type { EnvironmentId } from "@t3tools/contracts";
import { PersonaAvatar, usePersonaIdentity, type PersonaIdentity } from "./persona";

const STARTERS: ReadonlyArray<{
  readonly label: string;
  readonly prompt: string;
  readonly icon: ComponentType<{ className?: string }>;
}> = [
  {
    label: "No Fun dashboard",
    icon: LayoutDashboardIcon,
    prompt:
      "Build a No Fun dashboard artifact for this project: the few numbers that matter, one chart, and what changed this week.",
  },
  {
    label: "Prototype with variants",
    icon: LayersIcon,
    prompt:
      "Prototype this as a No Fun artifact with three variants side by side so I can pick one: ",
  },
  {
    label: "/agent-fleet",
    icon: UsersIcon,
    prompt: "/agent-fleet ",
  },
];

export function NofunStarters(props: { readonly onPick: (prompt: string) => void }) {
  return (
    <div
      data-nofun-starters
      className="flex flex-wrap items-center justify-center gap-2 px-4"
      aria-label="Starters"
      role="group"
    >
      {STARTERS.map((starter) => (
        <Button
          key={starter.label}
          variant="glass"
          size="sm"
          onClick={() => props.onPick(starter.prompt)}
        >
          <starter.icon />
          {starter.label}
        </Button>
      ))}
    </div>
  );
}

/** The persona mark above the draft headline: unmistakable before the first send. */
export function NofunHeroMark(props: { readonly persona: PersonaIdentity }) {
  const { persona } = props;
  return (
    <div data-nofun-hero={persona.id} className="mb-5 flex flex-col items-center gap-2.5">
      <PersonaAvatar persona={persona} decorative={false} className="size-14 drop-shadow-md" />
      <p
        className="font-mono text-2xs font-semibold uppercase tracking-widest text-muted-foreground"
        style={persona.isAlternate && persona.accent ? { color: persona.accent } : undefined}
      >
        {persona.isAlternate ? `You're in ${persona.label}` : "No Fun T3"}
      </p>
    </div>
  );
}

export function NofunPersonaBannerTitle(props: { readonly persona: PersonaIdentity }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-foreground">
        {props.persona.accent ? (
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full"
            style={{ backgroundColor: props.persona.accent }}
          />
        ) : null}
        You're in {props.persona.label}
      </span>
      <span className="min-w-0 truncate font-normal text-muted-foreground">
        projects, providers and logins here belong to {props.persona.label}
      </span>
    </span>
  );
}

/** Quiet persona mark for a thread that has no messages yet. */
export function NofunTimelineEmptyMark(props: { readonly environmentId: EnvironmentId }) {
  const persona = usePersonaIdentity(props.environmentId);
  return (
    <div className="mb-3 flex flex-col items-center gap-2">
      <PersonaAvatar persona={persona} className="size-10" />
      {persona.isAlternate ? (
        <p className="font-mono text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
          You're in {persona.label}
        </p>
      ) : null}
    </div>
  );
}
