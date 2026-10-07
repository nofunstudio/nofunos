/**
 * Background work of one thread for the Agents sidebar: what the thread left
 * running after its turn settled (dev servers, shells, monitors, watches). It
 * is the same derivation the composer's "Running: ..." strip uses
 * (`derivePendingBackgroundWork`), minus subagents (those are agents), joined to
 * the turn item that started each task for its start time, last activity and
 * latest output. Pure; the sidebar re-derives it when the projection changes.
 */
import type { OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/models";
import * as DateTime from "effect/DateTime";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import {
  latestUnheldRun,
  usageLimitRunPresentedAsLatest,
} from "@t3tools/shared/orchestrationV2ThreadError";

/** No activity for this long reads as "may be stuck". */
export const BACKGROUND_QUIET_MS = 5 * 60_000;
const OUTPUT_TAIL_LINES = 200;

export interface BackgroundRow {
  readonly taskId: string;
  readonly kind: OrchestrationV2PendingBackgroundTask["kind"];
  readonly label: string;
  readonly startedAt: string | null;
  readonly lastActivityAt: string | null;
  readonly quiet: boolean;
  /** Latest output lines, when the starting item carries them. */
  readonly output: ReadonlyArray<string> | null;
  readonly outputOmitted: boolean;
  readonly command: string | null;
}

type Projection = NonNullable<EnvironmentThread["projection"]>;

const KIND_LABEL: Record<BackgroundRow["kind"], string> = {
  command: "Command",
  monitor: "Watch",
  background_task: "Task",
  subagent: "Agent",
};
export const backgroundKindLabel = (kind: BackgroundRow["kind"]) => KIND_LABEL[kind];

function nativeId(item: Projection["turnItems"][number]): string {
  const native = item.nativeItemRef?.nativeId;
  return typeof native === "string" && native.length > 0 ? native : String(item.id);
}

export function deriveBackgroundRows(
  projection: Projection,
  now: number,
): ReadonlyArray<BackgroundRow> {
  const sessionError =
    projection.providerSessions.findLast(
      (session) => session.providerInstanceId === projection.thread.providerInstanceId,
    )?.lastError ?? null;
  const latestRun =
    usageLimitRunPresentedAsLatest(projection.runs, projection.turnItems, sessionError) ??
    latestUnheldRun(projection.runs);
  const tasks = derivePendingBackgroundWork({
    latestRun,
    providerThreads: projection.providerThreads,
    turnItems: projection.turnItems,
    activeProviderThreadId: projection.thread.activeProviderThreadId,
    runs: projection.runs,
    pullRequests: projection.thread.pullRequests,
  }).filter((task) => task.kind !== "subagent");
  const itemByTask = new Map(projection.turnItems.map((item) => [nativeId(item), item] as const));
  return tasks.map((task) => {
    const item = itemByTask.get(task.taskId);
    const updated = item ? DateTime.formatIso(item.updatedAt) : null;
    const command = item?.type === "command_execution" ? item.input : null;
    const output = item?.type === "command_execution" ? (item.output ?? "") : "";
    const label = task.description?.trim() || command?.trim() || KIND_LABEL[task.kind];
    return {
      taskId: task.taskId,
      kind: task.kind,
      label: label.length > 120 ? `${label.slice(0, 120)}…` : label,
      startedAt: item?.startedAt ? DateTime.formatIso(item.startedAt) : null,
      lastActivityAt: updated,
      quiet: updated !== null && now - Date.parse(updated) > BACKGROUND_QUIET_MS,
      output: output.length === 0 ? null : output.split("\n").slice(-OUTPUT_TAIL_LINES),
      outputOmitted: item?.type === "command_execution" && item.outputOmitted === true,
      command,
    };
  });
}
