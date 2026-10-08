/**
 * MuseWorkerBridge - External Muse worker bridge for the No Fun prototype.
 *
 * Lets the in-app Claude controller hand bounded work to Muse Code
 * (Muse Spark, subscription route) by spawning the owner's
 * `muse-worker.sh` wrapper as a child process. Muse is an EXTERNAL worker,
 * not a native T3 provider: results are unverified until the controller
 * checks them.
 *
 * Job state lives on disk under `<stateDir>/nofun/muse-jobs/<jobId>/`
 * (`prompt.md`, `job.json`, `stdout.log`, `stderr.log`) plus a
 * `by-request/<requestId>` index for idempotent start. Jobs whose process
 * is gone are marked `failed (lost)` on next access and never re-run.
 * Cancel signals ONLY the PID captured at spawn.
 *
 * @module MuseWorkerBridge
 */
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { PlatformError } from "effect/PlatformError";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as MuseUsage from "./MuseUsage.ts";
import { museChildEnvironment } from "./museUsage.logic.ts";

/** Profiles the controller may hand to the external worker. */
export type MuseWorkerProfile = "muse-review" | "muse-focused" | "muse-build";

const PROFILES: ReadonlyArray<MuseWorkerProfile> = ["muse-review", "muse-focused", "muse-build"];

const DEFAULT_WRAPPER = "/Users/nofun/Documents/GitHub/nofun-skills/scripts/muse-worker.sh";
const DEFAULT_MODEL = "muse-spark-1.3-contributor";
const MAX_PROMPT_CHARS = 100_000;
const TAIL_LINES = 80;
const STDERR_TAIL_LINES = 20;
const MAX_TAIL_LINE_CHARS = 2000;
const CANCEL_GRACE = "3 seconds" as const;
const ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

export class MuseJobNotFoundError extends Schema.TaggedError<MuseJobNotFoundError>()(
  "MuseJobNotFoundError",
  { jobId: Schema.String },
) {
  override get message(): string {
    return `Muse job ${this.jobId} does not exist.`;
  }
}

export class MuseWorkerInputError extends Schema.TaggedError<MuseWorkerInputError>()(
  "MuseWorkerInputError",
  {
    reason: Schema.Literals([
      "empty_prompt",
      "prompt_too_large",
      "workspace_not_absolute",
      "workspace_not_found",
      "workspace_not_directory",
      "unknown_profile",
      "bad_request_id",
      "unknown_account",
      "api_billing_refused",
    ]),
  },
) {
  override get message(): string {
    return `Invalid Muse worker start input: ${this.reason}.`;
  }
}

/** Every Muse subscription is out of five-hour or weekly quota. */
export class MuseLimitReachedError extends Schema.TaggedError<MuseLimitReachedError>()(
  "MuseLimitReachedError",
  { resetsAt: Schema.String },
) {
  override get message(): string {
    return `Every Muse subscription is at its usage limit until ${this.resetsAt}.`;
  }
}

export class MuseWorkerSpawnError extends Schema.TaggedError<MuseWorkerSpawnError>()(
  "MuseWorkerSpawnError",
  {
    workspace: Schema.String,
    profile: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to spawn the Muse worker for ${this.workspace} (${this.profile}).`;
  }
}

export class MuseWorkerIoError extends Schema.TaggedError<MuseWorkerIoError>()(
  "MuseWorkerIoError",
  {
    operation: Schema.String,
    path: Schema.String,
    // Absent only when no underlying failure exists (a kill that did not land).
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Muse job store I/O failed during ${this.operation} at ${this.path}.`;
  }
}

const MuseJobStatusSchema = Schema.Literals(["running", "succeeded", "failed", "cancelled"]);
type MuseJobStatus = typeof MuseJobStatusSchema.Type;

const MuseJobRecord = Schema.Struct({
  jobId: Schema.String,
  requestId: Schema.String,
  threadId: Schema.String,
  profile: Schema.String,
  workspace: Schema.String,
  pid: Schema.Number,
  status: MuseJobStatusSchema,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  model: Schema.String,
  resultPath: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  note: Schema.NullOr(Schema.String),
  /** The Muse subscription the job runs on; absent on jobs from before accounts. */
  account: Schema.optional(Schema.String),
});
type MuseJobRecord = typeof MuseJobRecord.Type;
const decodeJobRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(MuseJobRecord));

interface MuseStartResult {
  readonly jobId: string;
  readonly status: MuseJobStatus;
}

interface MuseStatusView {
  readonly jobId: string;
  readonly status: MuseJobStatus;
  readonly profile: string;
  readonly workspace: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly model: string;
  readonly exitCode: number | null;
  readonly note: string | null;
  readonly account: string | null;
  readonly tail: ReadonlyArray<string>;
  readonly stderrTail: ReadonlyArray<string>;
}

/** What the Fleet sidebar needs from a job: no prompt, no log output. */
export interface MuseJobSummary {
  readonly jobId: string;
  readonly status: MuseJobStatus;
  readonly profile: string;
  readonly model: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly note: string | null;
  readonly account: string | null;
}

interface MuseCancelResult {
  readonly jobId: string;
  readonly status: MuseJobStatus;
}

/** External Muse worker bridge: spawn bounded jobs, read them, cancel them. */
export class MuseWorkerBridge extends Context.Service<
  MuseWorkerBridge,
  {
    readonly start: (input: {
      readonly prompt: string;
      readonly workspace: string;
      readonly profile: MuseWorkerProfile;
      readonly requestId: string;
      readonly threadId: string;
      /** A Muse account id; omitted to let the pool pick. */
      readonly account?: string;
    }) => Effect.Effect<
      MuseStartResult,
      MuseWorkerInputError | MuseWorkerSpawnError | MuseWorkerIoError | MuseLimitReachedError
    >;
    readonly jobStatus: (
      jobId: string,
    ) => Effect.Effect<MuseStatusView, MuseJobNotFoundError | MuseWorkerIoError>;
    readonly cancel: (
      jobId: string,
    ) => Effect.Effect<MuseCancelResult, MuseJobNotFoundError | MuseWorkerIoError>;
    /** Jobs started by one thread, newest first. Read-only; no log tails. */
    readonly listForThread: (
      threadId: string,
    ) => Effect.Effect<ReadonlyArray<MuseJobSummary>, MuseWorkerIoError>;
  }
>()("t3/nofun/MuseWorkerBridge") {}

type LiveHandle = ChildProcessSpawner.ChildProcessHandle;

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const museUsage = yield* MuseUsage.MuseUsage;

  // Children live in this scope, not the request scope, so a job survives
  // the start call. Closing it (layer shutdown) reaps every live child.
  const childScope = yield* Scope.make();
  yield* Effect.addFinalizer((exit) => Scope.close(childScope, exit));
  // Handles for live jobs, so cancel and the exit watcher don't race on
  // the pid file alone. Reconcile covers restarts, where the map is empty.
  const live = yield* Ref.make(new Map<string, LiveHandle>());

  const jobsRoot = path.join(config.stateDir, "nofun", "muse-jobs");
  const requestsRoot = path.join(jobsRoot, "by-request");
  const crypto = yield* Crypto.Crypto;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const newJobId = Effect.gen(function* () {
    const millis = yield* Clock.currentTimeMillis;
    const uuid = yield* crypto.randomUUIDv4;
    return `muse-${millis.toString(36)}-${uuid.slice(0, 8)}`;
  });

  const ioError =
    (operation: string, filePath: string) =>
    (cause: unknown): MuseWorkerIoError =>
      new MuseWorkerIoError({ operation, path: filePath, cause });

  const jobDir = (jobId: string): string => path.join(jobsRoot, jobId);

  const readRecord = (
    jobId: string,
  ): Effect.Effect<MuseJobRecord, MuseJobNotFoundError | MuseWorkerIoError> =>
    Effect.gen(function* () {
      if (!ID_PATTERN.test(jobId)) {
        return yield* new MuseJobNotFoundError({ jobId });
      }
      const file = path.join(jobDir(jobId), "job.json");
      const raw = yield* fileSystem
        .readFileString(file)
        .pipe(
          Effect.mapError((cause) =>
            cause.reason._tag === "NotFound"
              ? new MuseJobNotFoundError({ jobId })
              : ioError("read-job", file)(cause),
          ),
        );
      return yield* decodeJobRecord(raw).pipe(Effect.mapError(ioError("decode-job", file)));
    });

  const writeRecord = (record: MuseJobRecord): Effect.Effect<void, MuseWorkerIoError> =>
    fileSystem
      .writeFileString(
        path.join(jobDir(record.jobId), "job.json"),
        `${JSON.stringify(record, null, 2)}\n`,
      )
      .pipe(Effect.mapError(ioError("write-job", jobDir(record.jobId))));

  /** Signal 0 probes liveness without delivering anything. */
  const isPidAlive = (pid: number): Effect.Effect<boolean> =>
    Effect.sync(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        // ESRCH means no such process; anything else (e.g. EPERM) means it exists.
        return (error as NodeJS.ErrnoException | undefined)?.code !== "ESRCH";
      }
    });

  const reconcileRecord = (
    record: MuseJobRecord,
  ): Effect.Effect<MuseJobRecord, MuseWorkerIoError> =>
    Effect.gen(function* () {
      if (record.status !== "running") return record;
      if (yield* isPidAlive(record.pid)) return record;
      // The worker is gone and its exit was never observed: mark it lost.
      // Lost jobs are never re-run; the controller must start a new one.
      const lost: MuseJobRecord = {
        ...record,
        status: "failed",
        finishedAt: yield* nowIso,
        note: "lost: worker process is gone (server restarted or process died); never re-run",
      };
      yield* writeRecord(lost);
      return lost;
    });

  const reconcileAll = Effect.gen(function* () {
    const entries = yield* fileSystem
      .readDirectory(jobsRoot)
      .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)));
    yield* Effect.forEach(
      entries,
      (entry) =>
        entry === "by-request"
          ? Effect.void
          : readRecord(entry).pipe(
              Effect.flatMap(reconcileRecord),
              Effect.catch(() =>
                Effect.logWarning("Skipping unreadable Muse job during reconcile.", { entry }),
              ),
            ),
      { discard: true },
    );
  });

  const readTail = (
    file: string,
    maxLines: number,
  ): Effect.Effect<Array<string>, MuseWorkerIoError> =>
    Effect.gen(function* () {
      const text = yield* fileSystem
        .readFileString(file)
        .pipe(
          Effect.catch((cause) =>
            cause.reason._tag === "NotFound"
              ? Effect.succeed("")
              : Effect.fail(ioError("read-log", file)(cause)),
          ),
        );
      const lines = text.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      return lines
        .slice(-maxLines)
        .map((line) =>
          line.length > MAX_TAIL_LINE_CHARS ? `${line.slice(0, MAX_TAIL_LINE_CHARS)}…` : line,
        );
    });

  const toView = (
    record: MuseJobRecord,
    tail: ReadonlyArray<string>,
    stderrTail: ReadonlyArray<string>,
  ): MuseStatusView => ({
    jobId: record.jobId,
    status: record.status,
    profile: record.profile,
    workspace: record.workspace,
    pid: record.pid,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    model: record.model,
    exitCode: record.exitCode,
    note: record.note,
    account: record.account ?? null,
    tail,
    stderrTail,
  });

  const finishFromExit = (jobId: string, rawExitCode: number) =>
    Effect.gen(function* () {
      const current = yield* readRecord(jobId).pipe(
        Effect.asSome,
        Effect.catch(() => Effect.succeed(Option.none<MuseJobRecord>())),
      );
      // A cancel that landed first wins; never overwrite a terminal status.
      if (current._tag === "None" || current.value.status !== "running") return;
      const record = current.value;
      yield* writeRecord({
        ...record,
        status: rawExitCode === 0 ? "succeeded" : "failed",
        finishedAt: yield* nowIso,
        exitCode: rawExitCode,
        note: rawExitCode === 0 ? null : `worker exited with code ${rawExitCode}`,
      }).pipe(Effect.ignore);
      yield* Ref.update(live, (handles) => {
        const next = new Map(handles);
        next.delete(jobId);
        return next;
      });
    });

  const terminateHandle = (handle: LiveHandle): Effect.Effect<void> =>
    Effect.gen(function* () {
      // ONLY the captured child is signalled, never its process group or children.
      yield* handle.kill({ killSignal: "SIGTERM" }).pipe(Effect.ignore);
      yield* Effect.sleep(CANCEL_GRACE);
      const running = yield* handle.isRunning.pipe(Effect.catch(() => Effect.succeed(false)));
      if (running) yield* handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore);
    });

  const terminatePid = (pid: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Already gone; the liveness check below settles it.
        }
      });
      yield* Effect.sleep(CANCEL_GRACE);
      const alive = yield* isPidAlive(pid);
      if (alive) {
        yield* Effect.sync(() => {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Gone between the probe and the signal.
          }
        });
      }
    });

  const start: MuseWorkerBridge["Service"]["start"] = (input) =>
    Effect.gen(function* () {
      if (input.prompt.length === 0) {
        return yield* new MuseWorkerInputError({ reason: "empty_prompt" });
      }
      if (input.prompt.length > MAX_PROMPT_CHARS) {
        return yield* new MuseWorkerInputError({ reason: "prompt_too_large" });
      }
      if (!PROFILES.includes(input.profile)) {
        return yield* new MuseWorkerInputError({ reason: "unknown_profile" });
      }
      if (!ID_PATTERN.test(input.requestId)) {
        return yield* new MuseWorkerInputError({ reason: "bad_request_id" });
      }
      if (!path.isAbsolute(input.workspace)) {
        return yield* new MuseWorkerInputError({ reason: "workspace_not_absolute" });
      }

      // Restart recovery runs lazily here: a restarted server marks jobs with
      // dead PIDs as failed (lost) instead of re-running them.
      yield* reconcileAll;

      // Idempotent start: a recorded requestId returns its original job.
      const indexFile = path.join(requestsRoot, input.requestId);
      const existingId = yield* fileSystem.readFileString(indexFile).pipe(
        Effect.asSome,
        Effect.catch(() => Effect.succeed(Option.none<string>())),
      );
      if (existingId._tag === "Some") {
        // An index without its job record is store corruption, not a job:
        // surface it instead of inventing a second job for the request.
        const existing = yield* readRecord(existingId.value.trim()).pipe(
          Effect.mapError((cause) =>
            cause._tag === "MuseJobNotFoundError"
              ? ioError("read-index-job", indexFile)(cause)
              : cause,
          ),
        );
        const reconciled = yield* reconcileRecord(existing);
        return { jobId: reconciled.jobId, status: reconciled.status };
      }

      const workspaceInfo = yield* fileSystem.stat(input.workspace).pipe(
        Effect.mapError((cause) =>
          cause.reason._tag === "NotFound"
            ? new MuseWorkerInputError({ reason: "workspace_not_found" })
            : new MuseWorkerIoError({
                operation: "stat-workspace",
                path: input.workspace,
                cause,
              }),
        ),
      );
      if (workspaceInfo.type !== "Directory") {
        return yield* new MuseWorkerInputError({ reason: "workspace_not_directory" });
      }

      // The wrapper refuses to run when META_API_KEY is set, so the parent
      // environment passes through untouched: no metered-billing fallback.
      // Route to the subscription with the most five-hour room; when all are
      // spent the caller hears when the first resets and can pick another model.
      // An explicit account runs there or not at all; the pool takes the
      // subscription with the most five-hour room. A spent account is never
      // swapped for another mid-request, and the caller hears when it resets.
      const pick = yield* museUsage.pickAccount(input.account);
      if (pick?._tag === "Unknown" || (pick === null && input.account !== undefined)) {
        return yield* new MuseWorkerInputError({ reason: "unknown_account" });
      }
      if (pick?._tag === "AllLimited") {
        return yield* new MuseLimitReachedError({
          resetsAt: DateTime.formatIso(DateTime.makeUnsafe(pick.resetsAtMs)),
        });
      }
      const account = pick?._tag === "Account" ? pick.account : null;
      const childEnv = account ? museChildEnvironment(account, process.env) : null;
      if (childEnv && "refused" in childEnv) {
        return yield* new MuseWorkerInputError({ reason: "api_billing_refused" });
      }
      const wrapper =
        account?.workerExecutable ??
        ((process.env.NOFUN_MUSE_WORKER ?? "").trim() || DEFAULT_WRAPPER);
      const model = (process.env.NOFUN_MUSE_MODEL ?? "").trim() || DEFAULT_MODEL;
      const jobId = yield* newJobId.pipe(Effect.mapError(ioError("new-job-id", jobsRoot)));
      const dir = jobDir(jobId);
      const promptPath = path.join(dir, "prompt.md");
      const stdoutPath = path.join(dir, "stdout.log");
      const stderrPath = path.join(dir, "stderr.log");
      yield* fileSystem
        .makeDirectory(dir, { recursive: true })
        .pipe(Effect.mapError(ioError("make-job-dir", dir)));
      yield* fileSystem
        .writeFileString(promptPath, input.prompt)
        .pipe(Effect.mapError(ioError("write-prompt", promptPath)));
      yield* fileSystem
        .writeFileString(stdoutPath, "")
        .pipe(Effect.mapError(ioError("init-log", stdoutPath)));
      yield* fileSystem
        .writeFileString(stderrPath, "")
        .pipe(Effect.mapError(ioError("init-log", stderrPath)));

      const command = ChildProcess.make(
        wrapper,
        [
          "--workspace",
          input.workspace,
          "--prompt-file",
          promptPath,
          "--task-id",
          jobId,
          "--profile",
          input.profile,
          "--model",
          model,
        ],
        {
          cwd: input.workspace,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: process.platform !== "win32",
          // The account's own environment replaces the server's, never extends it.
          ...(childEnv ? { env: childEnv.env, extendEnv: false } : {}),
        },
      );
      // The spawn lives in the service scope so the job outlives this call.
      // Closing that scope (layer shutdown) reaps every live child.
      const handle = yield* spawner.spawn(command).pipe(
        Effect.provideService(Scope.Scope, childScope),
        Effect.mapError(
          (cause) =>
            new MuseWorkerSpawnError({ workspace: input.workspace, profile: input.profile, cause }),
        ),
      );
      // PID 0 (or an invalid pid) would make signal 0 hit the process group:
      // never record it, kill what we spawned, and fail loudly instead.
      const pid = Number(handle.pid);
      if (!Number.isInteger(pid) || pid <= 0) {
        yield* handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore);
        return yield* new MuseWorkerSpawnError({
          workspace: input.workspace,
          profile: input.profile,
        });
      }

      const startedAt = yield* nowIso;
      const record: MuseJobRecord = {
        jobId,
        requestId: input.requestId,
        threadId: input.threadId,
        profile: input.profile,
        workspace: input.workspace,
        pid,
        status: "running",
        startedAt,
        finishedAt: null,
        model,
        resultPath: stdoutPath,
        exitCode: null,
        note: null,
        ...(account ? { account: account.id } : {}),
      };
      yield* writeRecord(record);
      yield* fileSystem
        .makeDirectory(requestsRoot, { recursive: true })
        .pipe(Effect.mapError(ioError("make-request-index", requestsRoot)));
      yield* fileSystem
        .writeFileString(indexFile, jobId)
        .pipe(Effect.mapError(ioError("write-request-index", indexFile)));
      yield* Ref.update(live, (handles) => new Map(handles).set(jobId, handle));

      // Detached pumps drain stdout/stderr to the log files while the job
      // runs (an undrained pipe would wedge a chatty worker past 64k), then
      // the exit code settles job.json. A cancel that lands first wins.
      const pump = (stream: Stream.Stream<Uint8Array, PlatformError>, file: string) =>
        stream.pipe(
          Stream.runForEach((chunk) =>
            fileSystem.writeFile(file, chunk, { flag: "a" }).pipe(
              Effect.mapError(ioError("append-log", file)),
              Effect.catch((error) => Effect.logWarning(error)),
            ),
          ),
          Effect.ignore,
        );
      yield* Effect.forkDetach(
        Effect.gen(function* () {
          const outPump = yield* Effect.forkDetach(pump(handle.stdout, stdoutPath));
          const errPump = yield* Effect.forkDetach(pump(handle.stderr, stderrPath));
          const exitCode = yield* handle.exitCode.pipe(
            Effect.map(Number),
            Effect.catch(() => Effect.succeed(-1)),
          );
          yield* Fiber.join(outPump);
          yield* Fiber.join(errPump);
          yield* finishFromExit(jobId, exitCode);
        }).pipe(Effect.ignore),
      );

      return { jobId, status: record.status };
    });

  const jobStatus: MuseWorkerBridge["Service"]["jobStatus"] = (jobId) =>
    Effect.gen(function* () {
      const record = yield* reconcileRecord(yield* readRecord(jobId));
      const dir = jobDir(record.jobId);
      const tail = yield* readTail(path.join(dir, "stdout.log"), TAIL_LINES);
      const stderrTail = yield* readTail(path.join(dir, "stderr.log"), STDERR_TAIL_LINES);
      return toView(record, tail, stderrTail);
    });

  const cancel: MuseWorkerBridge["Service"]["cancel"] = (jobId) =>
    Effect.gen(function* () {
      const record = yield* reconcileRecord(yield* readRecord(jobId));
      if (record.status !== "running") return { jobId: record.jobId, status: record.status };
      const handle = (yield* Ref.get(live)).get(jobId);
      if (handle !== undefined) {
        const running = yield* handle.isRunning.pipe(Effect.catch(() => Effect.succeed(false)));
        if (running) yield* terminateHandle(handle);
      } else {
        // Post-restart: no handle survived, so signal the recorded PID only.
        yield* terminatePid(record.pid);
      }
      let alive: boolean;
      if (handle !== undefined) {
        alive = yield* handle.isRunning.pipe(Effect.catch(() => Effect.succeed(false)));
      } else {
        alive = yield* isPidAlive(record.pid);
      }
      if (alive) {
        // The signal did not land; report the failure instead of lying.
        return yield* new MuseWorkerIoError({ operation: "cancel", path: jobDir(jobId) });
      }
      const cancelled: MuseJobRecord = {
        ...record,
        status: "cancelled",
        finishedAt: yield* nowIso,
        note: "cancelled by controller",
      };
      yield* writeRecord(cancelled);
      yield* Ref.update(live, (handles) => {
        const next = new Map(handles);
        next.delete(jobId);
        return next;
      });
      return { jobId: cancelled.jobId, status: cancelled.status };
    });

  const listForThread: MuseWorkerBridge["Service"]["listForThread"] = (threadId) =>
    Effect.gen(function* () {
      const entries = yield* fileSystem
        .readDirectory(jobsRoot)
        .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)));
      const records = yield* Effect.forEach(
        entries.filter((entry) => entry !== "by-request"),
        (entry) =>
          readRecord(entry).pipe(
            Effect.flatMap(reconcileRecord),
            Effect.asSome,
            Effect.catch(() => Effect.succeed(Option.none<MuseJobRecord>())),
          ),
      );
      return records
        .flatMap((record) => (Option.isSome(record) ? [record.value] : []))
        .filter((record) => record.threadId === threadId)
        .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map((record): MuseJobSummary => ({
          jobId: record.jobId,
          status: record.status,
          profile: record.profile,
          model: record.model,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          note: record.note,
          account: record.account ?? null,
        }));
    });

  return MuseWorkerBridge.of({ start, jobStatus, cancel, listForThread });
});

export const layer = Layer.effect(MuseWorkerBridge, make);
