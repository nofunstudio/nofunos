import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as MuseWorkerBridge from "../../../nofun/MuseWorkerBridge.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, MuseWorkerBridge.MuseWorkerBridge];

const MuseProfile = Schema.Literals(["muse-review", "muse-focused", "muse-build"]);
const MuseJobStatus = Schema.Literals(["running", "succeeded", "failed", "cancelled"]);

// Muse runs as an EXTERNAL worker outside T3's providers (Muse Spark on the
// subscription route), so every tool below states that up front. Exit 0 from
// the worker means its turn completed, not that the work is correct: results
// are unverified until the controller checks them.
const MuseTaskStartTool = Tool.make("muse_task_start", {
  description:
    "Hand bounded work to Muse, an EXTERNAL worker (Muse Spark, not a native T3 provider), and get back a jobId. The worker runs the owner's muse-worker.sh wrapper with the given profile and writes its output to a job log; poll muse_task_status for the result. Read-only profiles (muse-review) cannot run commands: no tsc, no tests, no shell, so their reports need independent verification and their results are unverified until the controller checks them. muse-focused runs read-write in place; muse-build starts a fresh worktree. Start is idempotent by requestId: retrying with the same requestId returns the original job.",
  parameters: Schema.Struct({
    prompt: Schema.String.annotate({
      description: "The bounded task packet for the worker (file content, never a shell argument).",
    }),
    workspace: Schema.String.annotate({
      description: "Absolute path of the checkout or worktree the worker is rooted at.",
    }),
    profile: MuseProfile.annotate({
      description:
        "muse-review (read-only investigation), muse-focused (read-write in place), or muse-build (fresh worktree).",
    }),
    requestId: Schema.String.annotate({
      description:
        "Caller-chosen idempotency key ([a-zA-Z0-9._-], max 128 chars). Reuse it across retries of the same delegation.",
    }),
    account: Schema.optional(Schema.String).annotate({
      description:
        "Muse subscription id to run on (for example muse-personal or muse-backstage-support). Omit to let the pool pick the account with the most five-hour room; spread independent tasks by omitting it. An explicit account never falls back to another one.",
    }),
  }),
  success: Schema.Struct({
    jobId: Schema.String,
    status: MuseJobStatus,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Start a Muse worker task")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Idempotent, true);

const MuseTaskStatusTool = Tool.make("muse_task_status", {
  description:
    "Read an EXTERNAL Muse worker job started by muse_task_start: its status plus the last ~80 lines of its output log. A terminal status means the worker's turn completed, not that the work is correct: results are unverified until the controller checks them. Read-only profiles (muse-review) cannot run commands, so treat their reports as unverified reading notes.",
  parameters: Schema.Struct({
    jobId: Schema.String.annotate({ description: "Job id returned by muse_task_start." }),
  }),
  success: Schema.Struct({
    jobId: Schema.String,
    status: MuseJobStatus,
    profile: Schema.String,
    workspace: Schema.String,
    pid: Schema.Number,
    startedAt: Schema.String,
    finishedAt: Schema.NullOr(Schema.String),
    model: Schema.String,
    exitCode: Schema.NullOr(Schema.Int),
    note: Schema.NullOr(Schema.String),
    account: Schema.NullOr(Schema.String),
    tail: Schema.Array(Schema.String),
    stderrTail: Schema.Array(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get a Muse worker task status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const MuseTaskCancelTool = Tool.make("muse_task_cancel", {
  description:
    "Stop an EXTERNAL Muse worker job started by muse_task_start. Only the worker process captured at spawn is signalled (SIGTERM, then SIGKILL); anything it spawned stays running. A terminal job returns its existing status. Results already written stay available through muse_task_status.",
  parameters: Schema.Struct({
    jobId: Schema.String.annotate({ description: "Job id returned by muse_task_start." }),
  }),
  success: Schema.Struct({
    jobId: Schema.String,
    status: MuseJobStatus,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Cancel a Muse worker task")
  .annotate(Tool.Destructive, true);

export const MuseToolkit = Toolkit.make(MuseTaskStartTool, MuseTaskStatusTool, MuseTaskCancelTool);
