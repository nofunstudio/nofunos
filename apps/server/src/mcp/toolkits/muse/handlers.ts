import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as MuseWorkerBridge from "../../../nofun/MuseWorkerBridge.ts";
import { MuseToolkit } from "./tools.ts";

// The bridge owns spawning, logging, and the job store; each handler decodes
// the request, calls one service method as the calling thread, and maps the
// typed error to the transport failure. No raw causes or outputs reach the
// message: they stay in the service error for server logs.
const museJobNotFound = (error: MuseWorkerBridge.MuseJobNotFoundError) =>
  Effect.fail(
    new OrchestratorMcpFailure({
      code: "task_not_found" as const,
      message: `Muse job ${error.jobId} does not exist.`,
    }),
  );
const museWorkerInput = (error: MuseWorkerBridge.MuseWorkerInputError) =>
  Effect.fail(
    new OrchestratorMcpFailure({
      code: "invalid_request" as const,
      message: `Invalid muse_task_start input: ${error.reason}.`,
    }),
  );
const museWorkerSpawn = (error: MuseWorkerBridge.MuseWorkerSpawnError) =>
  Effect.fail(
    new OrchestratorMcpFailure({
      code: "provider_unavailable" as const,
      message: `Could not start the external Muse worker for ${error.workspace} (${error.profile}).`,
    }),
  );
const museLimitReached = (error: MuseWorkerBridge.MuseLimitReachedError) =>
  Effect.fail(
    new OrchestratorMcpFailure({
      code: "provider_unavailable" as const,
      message: `${error.message} Use a different model for this work until then.`,
    }),
  );
const museWorkerIo = (error: MuseWorkerBridge.MuseWorkerIoError) =>
  Effect.fail(
    new OrchestratorMcpFailure({
      code: "orchestration_error" as const,
      message: `Muse job store I/O failed during ${error.operation}.`,
    }),
  );

const handlers = {
  muse_task_start: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "muse_task_start");
      const bridge = yield* MuseWorkerBridge.MuseWorkerBridge;
      return yield* bridge
        .start({
          prompt: input.prompt,
          workspace: input.workspace,
          profile: input.profile,
          requestId: input.requestId,
          threadId: thread.threadId,
        })
        .pipe(
          Effect.catchTags({
            MuseWorkerInputError: museWorkerInput,
            MuseWorkerSpawnError: museWorkerSpawn,
            MuseWorkerIoError: museWorkerIo,
            MuseLimitReachedError: museLimitReached,
          }),
        );
    }),
  muse_task_status: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      yield* McpInvocationContext.requireThreadScope(scope, "muse_task_status");
      const bridge = yield* MuseWorkerBridge.MuseWorkerBridge;
      return yield* bridge.jobStatus(input.jobId).pipe(
        Effect.catchTags({
          MuseJobNotFoundError: museJobNotFound,
          MuseWorkerIoError: museWorkerIo,
        }),
      );
    }),
  muse_task_cancel: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      yield* McpInvocationContext.requireThreadScope(scope, "muse_task_cancel");
      const bridge = yield* MuseWorkerBridge.MuseWorkerBridge;
      return yield* bridge.cancel(input.jobId).pipe(
        Effect.catchTags({
          MuseJobNotFoundError: museJobNotFound,
          MuseWorkerIoError: museWorkerIo,
        }),
      );
    }),
} satisfies Parameters<typeof MuseToolkit.toLayer>[0];

export const layer = MuseToolkit.toLayer(handlers);
