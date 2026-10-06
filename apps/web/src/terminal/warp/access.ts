import {
  type DeviceHubAccess,
  resolveDeviceHubAccess,
  withDeviceHubQuery,
} from "@t3tools/client-runtime/state/deviceHubAccess";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentSession } from "../../state/session";

export const WARP_BASE_PATH = "/api/warp";

// Same credential model as the preview stream: cookie sessions send the cookie,
// bearer and DPoP sessions get a short-lived ticket in the query string.
const warpAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: WARP_BASE_PATH });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`warp-access:${environmentId}`)),
);

export function readWarpAccess(environmentId: EnvironmentId): Promise<DeviceHubAccess | null> {
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, warpAccessAtom(environmentId), {
      suspendOnWaiting: true,
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}

export class WarpRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Authenticated JSON request to the Warp bridge routes. */
export async function warpRequest<T>(
  access: DeviceHubAccess,
  path: string,
  init?: { readonly method: "POST"; readonly body: unknown },
): Promise<T> {
  const response = await fetch(withDeviceHubQuery(`${access.httpBase}${path}`, access), {
    method: init?.method ?? "GET",
    credentials: access.credentials ? "include" : "omit",
    ...(init
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }
      : {}),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : `http_${response.status}`;
    const message = typeof body?.message === "string" ? body.message : code;
    throw new WarpRequestError(code, message);
  }
  return body as T;
}
