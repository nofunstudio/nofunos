/**
 * Row view-model for the Fleet sidebar: pure derivation from the v2 projection
 * (`subagents`) and the child thread shells. The sidebar
 * renders these rows and owns no state of its own.
 */
import type { ModelSelection, OrchestrationV2Subagent, ServerProvider } from "@t3tools/contracts";
import {
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";

import { getProviderModelCapabilities } from "../../providerModels";
import { backgroundKindLabel, type BackgroundRow } from "./backgroundModel";

export type FleetSource = "t3" | "native" | "background";
export type FleetPhase =
  | "queued"
  | "running"
  /** Background work with no output for a while. */
  | "quiet"
  | "waiting"
  | "done"
  | "failed"
  | "stopped";

export interface FleetRow {
  readonly key: string;
  readonly source: FleetSource;
  /** Provider driver kind ("claudeAgent", "codex", ...). */
  readonly driver: string;
  readonly title: string;
  /** Where the agent came from, in a few words: "from T3", "Claude native", "external". */
  readonly origin: string;
  readonly model: string | null;
  readonly effort: string | null;
  /** Context tokens used by the agent's latest turn, null when nothing reports them. */
  readonly tokens: number | null;
  readonly phase: FleetPhase;
  readonly active: boolean;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** The thread to open on click, when the agent has one. */
  readonly childThreadId: string | null;
  readonly depth: number;
}

const EFFORT_OPTION_IDS = ["reasoningEffort", "effort", "reasoning", "variant"] as const;

/** Reasoning level for a model selection, whatever the provider calls the option. */
export function resolveEffort(selection: ModelSelection | null | undefined): string | null {
  for (const id of EFFORT_OPTION_IDS) {
    const value = getModelSelectionStringOptionValue(selection, id);
    if (value) return value;
  }
  return null;
}

/** Default reasoning level the server catalog lists for an instance's model. */
export function defaultEffortFor(
  providers: ReadonlyArray<ServerProvider> | undefined,
  instanceId: string,
  model: string | null,
): string | null {
  const provider = providers?.find((candidate) => candidate.instanceId === instanceId);
  if (!provider || !model) return null;
  const caps = getProviderModelCapabilities(provider.models, model, provider.driver);
  for (const id of EFFORT_OPTION_IDS) {
    const descriptor = caps.optionDescriptors?.find((candidate) => candidate.id === id);
    const value = getProviderOptionCurrentValue(descriptor);
    if (typeof value === "string" && value) return value;
  }
  return null;
}

const PHASE_BY_STATUS: Record<OrchestrationV2Subagent["status"], FleetPhase> = {
  pending: "queued",
  running: "running",
  waiting: "waiting",
  idle: "done",
  completed: "done",
  failed: "failed",
  cancelled: "stopped",
  interrupted: "stopped",
};

export const PHASE_LABEL: Record<FleetPhase, string> = {
  queued: "Queued",
  running: "Working",
  quiet: "No output",
  waiting: "Needs input",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** The thread-relationship status words the details panel's agent rows speak. */
export function phaseRelationshipStatus(phase: FleetPhase): string {
  switch (phase) {
    case "queued":
      return "pending";
    case "running":
      return "running";
    case "waiting":
    case "quiet":
      return "waiting";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "cancelled";
  }
}

export function isActivePhase(phase: FleetPhase): boolean {
  return phase === "queued" || phase === "running" || phase === "quiet" || phase === "waiting";
}

const DRIVER_NAMES: Record<string, string> = {
  claudeAgent: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  pi: "Pi",
  muse: "Muse",
  background: "",
};

export function driverName(driver: string): string {
  return DRIVER_NAMES[driver] ?? driver;
}

export interface SubagentRowInput {
  readonly agent: Pick<
    OrchestrationV2Subagent,
    "id" | "origin" | "driver" | "title" | "prompt" | "model" | "status" | "childThreadId"
  >;
  readonly displayTitle: string;
  /** The child thread's model selection, when its shell is known. */
  readonly childSelection: ModelSelection | null | undefined;
  readonly tokens: number | null;
  /** The model's default reasoning level, shown when the child never picked one. */
  readonly defaultEffort?: string | null;
  readonly depth: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export function subagentRowPhase(status: OrchestrationV2Subagent["status"]): {
  readonly phase: FleetPhase;
  readonly active: boolean;
} {
  const phase = PHASE_BY_STATUS[status];
  return { phase, active: isActivePhase(phase) };
}

export function subagentRow(input: SubagentRowInput): FleetRow {
  const { agent } = input;
  const phase = PHASE_BY_STATUS[agent.status];
  const source: FleetSource = agent.origin === "app_owned" ? "t3" : "native";
  return {
    key: agent.id,
    source,
    driver: agent.driver,
    title: input.displayTitle,
    origin: source === "t3" ? "From T3" : `${driverName(agent.driver)} native`,
    model: agent.model ?? input.childSelection?.model ?? null,
    effort: resolveEffort(input.childSelection) ?? input.defaultEffort ?? null,
    tokens: input.tokens,
    phase,
    active: isActivePhase(phase),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    childThreadId: agent.childThreadId ?? null,
    depth: input.depth,
  };
}

export function backgroundRow(row: BackgroundRow): FleetRow {
  const phase: FleetPhase = row.quiet ? "quiet" : "running";
  return {
    key: row.taskId,
    source: "background",
    driver: "background",
    title: row.label,
    origin: `This thread · ${backgroundKindLabel(row.kind)}`,
    model: null,
    effort: null,
    tokens: null,
    phase,
    active: true,
    startedAt: row.startedAt,
    completedAt: null,
    childThreadId: null,
    depth: 0,
  };
}

/** "gpt-6-luna" stays as is; a dated provider id loses its date suffix. */
export function shortModelName(model: string | null): string | null {
  if (model === null) return null;
  return model.replace(/-\d{8}$/u, "");
}
