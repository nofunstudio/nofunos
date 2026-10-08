// @effect-diagnostics nodeBuiltinImport:off
/**
 * MuseUsage - five-hour and weekly quota for the No Fun Muse subscriptions.
 *
 * Muse only learns its usage from a frame on a model response, and `muse exec`
 * never reports it, so a reading costs one tiny turn through `muse serve`: the
 * `usage/changed` notification arrives as the turn starts and the probe exits.
 * Probes run in a private `XDG_DATA_HOME` so they never land in the owner's
 * Muse session list, and only when a reading is older than `STALE_AFTER`, so
 * the background loop and every Muse job start share one budget.
 *
 * Accounts come from `~/.nofun-t3/muse-accounts.json`; without that file
 * nothing is probed, so tests and other installs never spawn Muse. Readings
 * are not persisted.
 *
 * @module MuseUsage
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import type { UsageLimitSourceSnapshot } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import {
  NO_MUSE_ACCOUNTS,
  MuseAccountsFile,
  MuseSubscriptionUsage,
  museSourceSnapshot,
  museChildEnvironment,
  type MuseAccount,
  type MuseAccountState,
} from "./museUsage.logic.ts";
import { readNofunPersonaScope } from "./persona.ts";

const STALE_AFTER = Duration.minutes(30);
const CHECK_EVERY = "5 minutes" as const;
const PROBE_TIMEOUT = "60 seconds" as const;

export class MuseUsage extends Context.Service<
  MuseUsage,
  {
    /** One snapshot per configured subscription; empty on other personas. */
    readonly current: Effect.Effect<ReadonlyArray<UsageLimitSourceSnapshot>>;
    readonly streamChanges: Stream.Stream<ReadonlyArray<UsageLimitSourceSnapshot>>;
  }
>()("t3/nofun/MuseUsage") {}

const decodeAccountsFile = Schema.decodeUnknownEffect(Schema.fromJsonString(MuseAccountsFile));
const decodeUsage = Schema.decodeUnknownOption(MuseSubscriptionUsage);

const expandHome = (value: string) =>
  value === "~" || value.startsWith("~/") ? `${NodeOS.homedir()}${value.slice(1)}` : value;

/** UUIDv7, which MSP requires for every command id. */
function uuidV7(nowMs: number): string {
  const bytes = NodeCrypto.randomBytes(16);
  const ms = BigInt(nowMs);
  for (let index = 0; index < 6; index++)
    bytes[index] = Number((ms >> BigInt(40 - index * 8)) & 0xffn);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One `muse serve` session with a one-word turn, resolved by the first
 * `usage/changed`. The child is killed as soon as the reading lands, on
 * error, and on timeout; it never outlives the probe.
 */
function probeOnce(
  account: MuseAccount,
  env: Record<string, string>,
  nowMs: number,
  onIdentity: (email: string | null) => string | null,
) {
  return Effect.callback<MuseSubscriptionUsage, string>((resume) => {
    const child = NodeChildProcess.spawn(account.cliExecutable ?? "muse", ["serve"], {
      stdio: ["pipe", "pipe", "ignore"],
      env,
    });
    let settled = false;
    const finish = (result: Effect.Effect<MuseSubscriptionUsage, string>) => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resume(result);
    };
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        let message: {
          id?: number;
          method?: string;
          params?: unknown;
          result?: { session?: { sessionId?: string }; label?: string };
          error?: { message?: string };
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error) {
          finish(Effect.fail(message.error.message ?? "Muse refused the usage probe."));
          return;
        }
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "initialized" });
          send({ jsonrpc: "2.0", id: 4, method: "account/read", params: {} });
        } else if (message.id === 4) {
          // Identity first, from local login metadata: a wrong account never spends a turn.
          const refusal = onIdentity(message.result?.label ?? null);
          if (refusal) {
            finish(Effect.fail(refusal));
            return;
          }
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "session/start",
            params: { commandId: uuidV7(nowMs) },
          });
        } else if (message.id === 2) {
          const sessionId = message.result?.session?.sessionId;
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "turn/start",
            params: { sessionId, commandId: uuidV7(nowMs), input: [{ type: "text", text: "ok" }] },
          });
        } else if (message.method === "usage/changed") {
          const usage = decodeUsage(message.params);
          finish(
            usage._tag === "Some"
              ? Effect.succeed(usage.value)
              : Effect.fail("Muse reported usage in an unknown shape."),
          );
        }
      }
    });
    child.on("error", (error) => finish(Effect.fail(`Could not start muse: ${error.message}`)));
    child.on("exit", () => finish(Effect.fail("Muse exited before reporting usage.")));
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      // account/read is experimental in MSP v1.
      params: {
        clientInfo: { name: "t3_usage_probe", version: "1" },
        capabilities: { experimentalApi: true },
      },
    });
    return Effect.sync(() => finish(Effect.fail("Probe interrupted.")));
  }).pipe(
    Effect.timeoutOrElse({
      duration: PROBE_TIMEOUT,
      orElse: () => Effect.fail("Muse did not report usage in time."),
    }),
  );
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;

  const accountsPath =
    process.env.NOFUN_MUSE_ACCOUNTS?.trim() ||
    path.join(NodeOS.homedir(), ".nofun-t3", "muse-accounts.json");
  const personaId = readNofunPersonaScope()?.info.id ?? "nofun";
  const probeRoot = path.join(config.stateDir, "nofun", "muse-probe");

  const statesRef = yield* Ref.make<ReadonlyArray<MuseAccountState>>([]);
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<ReadonlyArray<UsageLimitSourceSnapshot>>(),
    PubSub.shutdown,
  );
  const snapshots = Ref.get(statesRef).pipe(Effect.map((states) => states.map(museSourceSnapshot)));

  /** Accounts for this persona with `~` expanded, re-read each pass so edits need no restart. */
  const loadAccounts = fileSystem.readFileString(accountsPath).pipe(
    Effect.flatMap(decodeAccountsFile),
    Effect.catch(() => Effect.succeed(NO_MUSE_ACCOUNTS)),
    Effect.map((file) =>
      file.persona === personaId
        ? file.accounts.map((account) => ({
            ...account,
            ...(account.cliExecutable ? { cliExecutable: expandHome(account.cliExecutable) } : {}),
            ...(account.workerExecutable
              ? { workerExecutable: expandHome(account.workerExecutable) }
              : {}),
            ...(account.configHome ? { configHome: expandHome(account.configHome) } : {}),
            ...(account.dataHome ? { dataHome: expandHome(account.dataHome) } : {}),
          }))
        : [],
    ),
  );

  // One pass at a time, so a job start and the loop never probe one account twice.
  const lock = yield* Semaphore.make(1);
  const refreshStale = Effect.gen(function* () {
    const accounts = yield* loadAccounts;
    const previous = yield* Ref.get(statesRef);
    const now = yield* Clock.currentTimeMillis;
    const next: MuseAccountState[] = [];
    for (const account of accounts) {
      const prior = previous.find((state) => state.account.id === account.id);
      const fresh =
        prior?.checkedAtMs !== null &&
        prior?.checkedAtMs !== undefined &&
        now - prior.checkedAtMs < Duration.toMillis(STALE_AFTER);
      if (prior && fresh) {
        next.push({ ...prior, account });
        continue;
      }
      // Probe sessions go to a private data root; a launcher that pins its
      // own roots keeps them in that account's data root instead.
      const dataHome = path.join(probeRoot, account.id.replace(/[^a-zA-Z0-9_-]/g, "_"));
      yield* fileSystem.makeDirectory(dataHome, { recursive: true }).pipe(Effect.ignore);
      let signedInAs: string | null = prior?.signedInAs ?? null;
      const childEnv = museChildEnvironment(account, process.env, dataHome);
      const result =
        "refused" in childEnv
          ? ({ _tag: "Failure", failure: childEnv.refused } as const)
          : yield* probeOnce(account, childEnv.env, now, (email) => {
              signedInAs = email;
              const expected = account.expectedEmail?.toLowerCase();
              return expected && email?.toLowerCase() !== expected
                ? `Signed in as ${email ?? "nobody"}, expected ${account.expectedEmail}.`
                : null;
            }).pipe(Effect.result);
      const checkedAtMs = yield* Clock.currentTimeMillis;
      next.push(
        result._tag === "Success"
          ? { account, signedInAs, usage: result.success, error: null, checkedAtMs }
          : {
              account,
              signedInAs,
              // Keep the last good bars and say the refresh failed.
              usage: prior?.usage ?? null,
              error: result.failure,
              checkedAtMs,
            },
      );
      if (result._tag === "Failure") {
        yield* Effect.logDebug("muse usage probe failed", {
          account: account.id,
          cause: result.failure,
        });
      }
    }
    yield* Ref.set(statesRef, next);
    yield* PubSub.publish(changes, next.map(museSourceSnapshot));
    return next;
  }).pipe(lock.withPermits(1));

  // Like the hub sources: one read at boot, before any client holds a
  // lease, then only while a client wants provider status.
  yield* refreshStale.pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);
  yield* Effect.forever(
    Effect.sleep(CHECK_EVERY).pipe(
      Effect.andThen(backgroundPolicy.shouldRunScopeWork({ type: "provider-status" })),
      Effect.flatMap((shouldRun) => (shouldRun ? refreshStale : Effect.void)),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  return {
    current: snapshots,
    get streamChanges() {
      return Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = yield* snapshots;
          return Stream.concat(Stream.make(snapshot), Stream.fromSubscription(subscription));
        }),
      );
    },
  } satisfies MuseUsage["Service"];
});

export const layer = Layer.effect(MuseUsage, make);
