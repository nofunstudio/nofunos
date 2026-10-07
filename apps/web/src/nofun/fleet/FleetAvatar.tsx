/**
 * The agent's face in the Fleet sidebar: a small rounded tile tinted per
 * provider, with a status dot. Deterministic per driver, no images to load.
 */
import { ProviderDriverKind } from "@t3tools/contracts";
import { SparklesIcon, TerminalIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { ProviderInstanceIcon } from "../../components/chat/ProviderInstanceIcon";
import { cn } from "../../lib/utils";
import { driverName, type FleetPhase } from "./fleetModel";

const TINT: Record<string, string> = {
  claudeAgent: "#d97757",
  codex: "#6b7280",
  cursor: "#8a8a80",
  muse: "#8b5cf6",
  background: "#6b7280",
  grok: "#6b7280",
  opencode: "#8a8480",
  antigravity: "#5b87bf",
};

const DOT_BY_PHASE: Record<FleetPhase, string> = {
  queued: "bg-muted-foreground/60",
  running: "bg-info",
  quiet: "bg-warning",
  waiting: "bg-warning",
  done: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/60",
};

export function FleetAvatar(props: { readonly driver: string; readonly phase: FleetPhase }) {
  const tint = TINT[props.driver] ?? "#6b7280";
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
        "bg-(--fleet-tint)/12 ring-1 ring-(--fleet-tint)/20",
      )}
      style={{ "--fleet-tint": tint } as CSSProperties}
      aria-hidden
    >
      {props.driver === "muse" ? (
        <SparklesIcon className="size-3.5 text-(--fleet-tint)" />
      ) : props.driver === "background" ? (
        <TerminalIcon className="size-3.5 text-(--fleet-tint)" />
      ) : (
        <ProviderInstanceIcon
          driverKind={ProviderDriverKind.make(props.driver)}
          displayName={driverName(props.driver)}
          iconClassName="size-3.5"
          className="z-0"
        />
      )}
      <span
        className={cn(
          "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background",
          DOT_BY_PHASE[props.phase],
        )}
      />
    </span>
  );
}
