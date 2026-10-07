/**
 * Muse jobs for one thread. Muse is an external worker with no thread of its
 * own, so the server lists its jobs over HTTP. There is no polling: the list is
 * read on mount and again whenever the parent thread changes (a Muse job's
 * start, status and cancel calls all show up as parent thread activity).
 */
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import {
  resolveDeviceHubAccess,
  withDeviceHubQuery,
  type DeviceHubAccess,
} from "@t3tools/client-runtime/state/deviceHubAccess";
import { useCallback, useEffect, useState } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentSession } from "../../state/session";
import type { MuseJobSummary } from "./fleetModel";

const MUSE_BASE_PATH = "/api/nofun/muse-jobs";

const museAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: MUSE_BASE_PATH });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`muse-jobs-access:${environmentId}`)),
);

function readAccess(environmentId: EnvironmentId): Promise<DeviceHubAccess | null> {
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, museAccessAtom(environmentId), {
      suspendOnWaiting: true,
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}

async function request<T>(
  access: DeviceHubAccess,
  path: string,
  init?: { readonly body: unknown },
): Promise<T | null> {
  try {
    const response = await fetch(withDeviceHubQuery(`${access.httpBase}${path}`, access), {
      method: init ? "POST" : "GET",
      credentials: access.credentials ? "include" : "omit",
      ...(init
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }
        : {}),
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

export function useMuseJobs(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  /** Changes when the parent thread has new activity. */
  readonly refreshKey: string;
  readonly enabled: boolean;
}) {
  const [jobs, setJobs] = useState<ReadonlyArray<MuseJobSummary>>([]);
  const { environmentId, threadId, refreshKey, enabled } = input;

  const refresh = useCallback(async () => {
    const access = await readAccess(environmentId);
    if (access === null) return;
    const result = await request<{ jobs: ReadonlyArray<MuseJobSummary> }>(
      access,
      `?threadId=${encodeURIComponent(threadId)}`,
    );
    if (result !== null) setJobs(result.jobs);
  }, [environmentId, threadId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh, refreshKey]);

  const cancel = useCallback(
    async (jobId: string) => {
      const access = await readAccess(environmentId);
      if (access === null) return;
      await request(access, "/cancel", { body: { jobId } });
      await refresh();
    },
    [environmentId, refresh],
  );

  return { jobs, cancel };
}
