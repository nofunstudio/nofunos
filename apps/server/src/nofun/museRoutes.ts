/**
 * Muse jobs for the Fleet sidebar. Muse is an external worker, not a thread, so
 * its jobs are not in the orchestration projection; the sidebar reads them here
 * (the list, one job's log tail, cancel).
 * Thin transport: each route decodes input and calls one bridge method.
 */
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { authenticateMediaRequest } from "../auth/http.ts";
import * as MuseWorkerBridge from "./MuseWorkerBridge.ts";

export const MUSE_ROUTE_PREFIX = "/api/nofun/muse-jobs";

const CancelRequest = Schema.Struct({ jobId: Schema.String.check(Schema.isNonEmpty()) });

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const makeHandler = (bridge: MuseWorkerBridge.MuseWorkerBridge["Service"]) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    yield* authenticateMediaRequest(AuthOrchestrationOperateScope);
    const route = url.value.pathname.slice(MUSE_ROUTE_PREFIX.length);

    if (route === "" && request.method === "GET") {
      const threadId = url.value.searchParams.get("threadId") ?? "";
      if (threadId.length === 0) return json({ error: "bad_request" }, 400);
      const jobs = yield* bridge
        .listForThread(threadId)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      return jobs === null ? json({ error: "list_failed" }, 500) : json({ jobs });
    }

    if (route === "/log" && request.method === "GET") {
      const jobId = url.value.searchParams.get("jobId") ?? "";
      if (jobId.length === 0) return json({ error: "bad_request" }, 400);
      const view = yield* bridge.jobStatus(jobId).pipe(Effect.catch(() => Effect.succeed(null)));
      return view === null
        ? json({ error: "not_found" }, 404)
        : json({
            jobId: view.jobId,
            status: view.status,
            note: view.note,
            tail: view.tail,
            stderrTail: view.stderrTail,
          });
    }

    if (route === "/cancel" && request.method === "POST") {
      const body = yield* request.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CancelRequest)),
        Effect.option,
      );
      if (Option.isNone(body)) return json({ error: "bad_request" }, 400);
      const result = yield* bridge
        .cancel(body.value.jobId)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      return result === null ? json({ error: "cancel_failed" }, 500) : json(result);
    }

    return HttpServerResponse.text("Not Found", { status: 404 });
  });

export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const bridge = yield* MuseWorkerBridge.MuseWorkerBridge;
    const handler = makeHandler(bridge);
    yield* router.add("GET", MUSE_ROUTE_PREFIX, handler);
    yield* router.add("GET", `${MUSE_ROUTE_PREFIX}/log`, handler);
    yield* router.add("POST", `${MUSE_ROUTE_PREFIX}/cancel`, handler);
  }),
);
