import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import { AuthTerminalOperateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { authenticateMediaRequest } from "../../auth/http.ts";
import { ServerConfig } from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { TerminalManager } from "../Manager.ts";
import { makeWarpBridge, WARP_TERMINAL_ID_PATTERN, type WarpBridge } from "./bridge.ts";
import {
  makeWarpBundleServer,
  WARP_EMBED_PATH_PREFIX,
  warpContentType,
  type WarpBundleServer,
} from "./bundle.ts";
import { makeWarpTicketStore } from "./tickets.ts";

export const WARP_ROUTE_PREFIX = "/api/warp";
/** The guest sends its first `resize` right after connecting; the shell opens at that size. */
const FIRST_RESIZE_TIMEOUT_MS = 10_000;
const MAX_CONTROL_FRAME_BYTES = 4_096;

const SessionRequest = Schema.Struct({
  environmentId: Schema.String,
  threadId: Schema.String.check(Schema.isNonEmpty()),
  terminalId: Schema.String,
  cwd: Schema.String.check(Schema.isNonEmpty()),
  worktreePath: Schema.optional(Schema.NullOr(Schema.String)),
  label: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(64)))),
  reattach: Schema.optional(Schema.Boolean),
  surface: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(128)))),
});
const CloseRequest = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  terminalId: Schema.String,
});

const ResizeMessage = Schema.Struct({
  type: Schema.Literal("resize"),
  cols: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  rows: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
});
const decodeResizeMessage = Schema.decodeUnknownOption(ResizeMessage);

const parseJson = (chunk: string | Uint8Array): unknown => {
  try {
    return JSON.parse(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
  } catch {
    return null;
  }
};

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

/**
 * `GET /warp-embed/*`: the Warp bundle as static files on T3's own origin. It is
 * public code with no secrets (every shell still needs a ticket), so it is
 * unauthenticated: an iframe request cannot carry a bearer token. Only used when
 * the bundle declares sub-path support; otherwise the loopback listener serves it.
 */
const makeEmbedHandler = (bundle: WarpBundleServer) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const pathname = url.value.pathname;
    // Relative asset URLs only resolve against a trailing slash.
    if (pathname === WARP_EMBED_PATH_PREFIX) {
      return HttpServerResponse.redirect(`${WARP_EMBED_PATH_PREFIX}/${url.value.search}`, {
        status: 302,
      });
    }
    const status = yield* Effect.promise(() => bundle.status());
    if (status.state !== "ready" || status.mode !== "same-origin") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    const relative = yield* Effect.try({
      try: () => decodeURIComponent(pathname.slice(WARP_EMBED_PATH_PREFIX.length + 1)),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
    if (relative === null || relative.includes("\0")) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }
    const file = yield* Effect.promise(() => bundle.resolveFile(relative));
    if (file === null) return HttpServerResponse.text("Not Found", { status: 404 });
    return yield* HttpServerResponse.file(file, {
      headers: {
        "Content-Type": warpContentType(file),
        // Revalidate so a reinstalled bundle is picked up; `no-transform` keeps the
        // response compressor away from the 150+ MB wasm.
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    }).pipe(
      Effect.catch(() => Effect.succeed(HttpServerResponse.text("Not Found", { status: 404 }))),
    );
  });

const makeHandler = (bridge: WarpBridge, bundle: WarpBundleServer) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const route = url.value.pathname.slice(WARP_ROUTE_PREFIX.length);

    if (route === "/attach") {
      if (request.headers.upgrade?.toLowerCase() !== "websocket") {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      return yield* attach(bridge, bundle, request, url.value);
    }

    yield* authenticateMediaRequest(AuthTerminalOperateScope);

    if (route === "/bundle" && request.method === "GET") {
      return json(yield* Effect.promise(() => bundle.status()));
    }

    if (route === "/sessions" && request.method === "GET") {
      const threadId = url.value.searchParams.get("threadId") ?? "";
      return json({
        sessions: bridge.listSessions(threadId, url.value.searchParams.get("surface")),
      });
    }

    if (route === "/session" && request.method === "POST") {
      const body = yield* request.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(SessionRequest)),
        Effect.option,
      );
      if (Option.isNone(body)) return json({ error: "bad_request" }, 400);
      const status = yield* Effect.promise(() => bundle.status());
      if (status.state !== "ready") return json({ error: "bundle_missing", ...status }, 503);
      const minted = bridge.mintTicket({
        environmentId: body.value.environmentId,
        threadId: body.value.threadId,
        terminalId: body.value.terminalId,
        cwd: body.value.cwd,
        worktreePath: body.value.worktreePath ?? null,
        label: body.value.label ?? null,
        surface: body.value.surface ?? null,
        reattach: body.value.reattach === true,
        // Loopback mode: the socket comes from the bundle's own origin. Same-origin
        // mode: from whichever origin the authenticated page minting this ticket has.
        origin: status.mode === "loopback" ? status.origin : (request.headers.origin ?? null),
      });
      if (!minted.ok) {
        const conflict = minted.reason === "already_bound" || minted.reason === "session_exited";
        return json(
          { error: minted.reason },
          conflict ? 409 : minted.reason === "unknown_session" ? 404 : 400,
        );
      }
      return json({ ticket: minted.ticket, expiresAt: minted.expiresAt });
    }

    if (route === "/close" && request.method === "POST") {
      const body = yield* request.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CloseRequest)),
        Effect.option,
      );
      if (Option.isNone(body) || !WARP_TERMINAL_ID_PATTERN.test(body.value.terminalId)) {
        return json({ error: "bad_request" }, 400);
      }
      const closed = yield* bridge
        .closeSession(body.value)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (closed === null) return json({ error: "close_failed" }, 500);
      return closed ? json({ closed: true }) : json({ error: "not_owned" }, 404);
    }

    return HttpServerResponse.text("Not Found", { status: 404 });
  });

/**
 * `GET /api/warp/attach?ticket=` (WebSocket). The ticket is the whole
 * authorization: single use, short lived, and scoped to one new terminal in one
 * thread. The caller is the Warp guest, whose origin must be the bundle origin.
 */
const attach = (
  bridge: WarpBridge,
  bundle: WarpBundleServer,
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
) =>
  Effect.gen(function* () {
    const status = yield* Effect.promise(() => bundle.status());
    if (status.state !== "ready") return HttpServerResponse.text("Forbidden", { status: 403 });
    const ticket = url.searchParams.get("ticket") ?? "";
    // Redeemed before the upgrade: a bad ticket never reaches the PTY.
    const redeemed = bridge.redeemTicket(ticket);
    if (!redeemed.ok) {
      return HttpServerResponse.text(`Ticket ${redeemed.reason}`, { status: 401 });
    }
    const binding = redeemed.binding;
    // The ticket pins the origin the socket must come from: the bundle's loopback
    // origin, or the page origin that minted it. A ticket without a pin (the mint
    // request carried no Origin) is still single use and short lived.
    if (binding.origin !== null && request.headers.origin !== binding.origin) {
      return HttpServerResponse.text("Forbidden", { status: 403 });
    }

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const incoming = NodeHttpServerRequest.toIncomingMessage(request);
        delete incoming.headers["sec-websocket-extensions"];
        const socket = yield* request.upgrade;
        const reader = yield* socket.reader;
        const writer = yield* socket.writer;
        const sendFrame = (frame: Parameters<Parameters<WarpBridge["attach"]>[2]>[0]) =>
          writer
            .write(frame.kind === "text" ? frame.text : frame.bytes)
            .pipe(Effect.catch(() => Effect.void));

        // Wait for the first resize so the shell opens at the real size. Nothing
        // else is meaningful before `ready`, so other frames are dropped.
        const firstResize = Effect.gen(function* () {
          while (true) {
            const chunks = yield* reader.pull;
            for (const chunk of chunks) {
              if (typeof chunk !== "string") continue;
              const resize = decodeResizeMessage(parseJson(chunk));
              if (Option.isSome(resize))
                return { cols: resize.value.cols, rows: resize.value.rows };
            }
          }
        });
        const size = Option.getOrNull(
          yield* firstResize.pipe(Effect.timeoutOption(FIRST_RESIZE_TIMEOUT_MS)),
        );
        if (size === null) return HttpServerResponse.empty();

        const attached = yield* bridge.attach(binding, size, sendFrame).pipe(Effect.result);
        if (attached._tag === "Failure") {
          yield* Effect.logWarning("warp attach refused", { reason: attached.failure.reason });
          return HttpServerResponse.empty();
        }
        const attachment = attached.success;

        const receive = (chunk: string | Uint8Array) => {
          if (typeof chunk === "string") {
            if (chunk.length > MAX_CONTROL_FRAME_BYTES) return Effect.void;
            const resize = decodeResizeMessage(parseJson(chunk));
            return Option.isSome(resize)
              ? attachment
                  .resize(resize.value.cols, resize.value.rows)
                  .pipe(Effect.catch(() => Effect.void))
              : Effect.void;
          }
          return attachment.write(chunk).pipe(Effect.catch(() => Effect.void));
        };
        return yield* reader.pull.pipe(
          Effect.flatMap((chunks) => Effect.forEach(chunks, receive, { discard: true })),
          Effect.forever,
          Effect.ensuring(attachment.detach),
        );
      }),
    ).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.empty())));
  });

export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const terminals = yield* TerminalManager;
    const environmentId = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;
    const config = yield* ServerConfig;
    const bundle = makeWarpBundleServer(config.baseDir);
    const bridge = makeWarpBridge({
      terminals,
      tickets: makeWarpTicketStore(),
      environmentId,
    });
    yield* Effect.addFinalizer(() => Effect.promise(() => bundle.stop()));
    const handler = makeHandler(bridge, bundle);
    yield* router.add("GET", `${WARP_ROUTE_PREFIX}/*`, handler);
    yield* router.add("POST", `${WARP_ROUTE_PREFIX}/*`, handler);
    const embedHandler = makeEmbedHandler(bundle);
    yield* router.add("GET", WARP_EMBED_PATH_PREFIX, embedHandler);
    yield* router.add("GET", `${WARP_EMBED_PATH_PREFIX}/*`, embedHandler);
  }),
);
