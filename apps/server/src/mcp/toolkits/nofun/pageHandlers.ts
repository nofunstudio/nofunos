// @effect-diagnostics preferSchemaOverJson:off - model-facing JSON summaries, same as the image tool metadata.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import type { CompiledArtifact } from "@t3tools/nofun-artifacts/compiler";
import { HTML_RENDER_MAX_HEIGHT } from "@t3tools/shared/htmlRender";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { AiError, McpSchema, McpServer, Tool } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import {
  composeFromSections,
  composeFromSpec,
  countFlaws,
  describeReport,
  pageFeatures,
  poolFor,
} from "../../../nofun/pages/compose.ts";
import { compilePage } from "@t3tools/nofun-artifacts/compiler";
import {
  composeVariant,
  isWeak,
  judgePages,
  makeEvaluator,
  JevUnavailableError,
  type Judged,
  type Variant,
} from "../../../nofun/pages/jev.ts";
import { parseFlatSpec, type FlatSpec } from "../../../nofun/pages/spec.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { readMutationCaller } from "../../threadAccess.ts";
import {
  NofunPageCatalogToolkit,
  NofunPageComposeTool,
  NofunPageComposeToolkit,
  NofunPageToolkit,
  NofunPageVariantsToolkit,
} from "./pageTools.ts";

const INVALID_PAGE_ERRORS = new Set([
  "HtmlRenderImagesNotFoundError",
  "HtmlRenderImageTooLargeError",
  "HtmlRenderPageTooLargeError",
]);

const toFailure = (error: { readonly _tag: string; readonly message: string }) =>
  new OrchestratorMcpFailure({
    code: INVALID_PAGE_ERRORS.has(error._tag) ? "invalid_request" : "orchestration_error",
    message: error.message,
  });

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/** Variants spend gateway requests: about 2 per page plus 1 judge call per 10 pages. */
const MAX_VARIANTS = 12;
const REQUEST_BUDGET = 40;
const CONCURRENCY = 4;

const compile = (page: {
  readonly spec: FlatSpec;
  readonly brand: string;
  readonly title: string;
}) =>
  Effect.tryPromise({
    try: (): Promise<CompiledArtifact> => compilePage(page),
    catch: (error) =>
      new OrchestratorMcpFailure({
        code: "orchestration_error",
        message: `The No Fun page compiler failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
  }).pipe(Effect.withSpan("NofunPage.compile"));

const stats = (compiled: CompiledArtifact) => ({
  theme: compiled.theme,
  lane: compiled.lane,
  bytes: compiled.bytes,
  compileMs: compiled.compileMs,
});

/** What the model should look for in the two screenshots. The tool cannot see pixels itself. */
const CHECKLIST = [
  "Clipped headline: a hero or marquee title cut off at the edge, especially in the 390 wide shot.",
  "Empty block: a section that shows only a box, a blank band or missing images (see missingImages).",
  "Low-contrast hero title: title text that fades into the photo or ground behind it.",
  "Repeated products: the same product tiles in the hero and again in the buying section.",
  "Anything in consoleMessages at level error.",
  "If any of these is true, change the section list (a quieter hero, another buying block) and call again with publish false.",
];

const handlers = {
  nofun_page_catalog: (input) =>
    Effect.sync(() => {
      const pool = poolFor(input.brand ?? "");
      const slots: Record<string, string[]> = {};
      for (const c of pool.kept) {
        if (c.root) continue;
        const v = typeof c.element.props.variant === "string" ? `:${c.element.props.variant}` : "";
        (slots[c.resource ?? "other"] ??= []).push(
          `${c.id} | ${c.element.type}${v} | ${c.description}`,
        );
      }
      return {
        brand: pool.brand.id || "neutral",
        knownBrand: pool.brand.known,
        brandNote: pool.brand.known
          ? `${pool.brand.facts.about}; ${pool.brand.facts.note}`
          : "No authored profile for this brand: treated as calm with no photography, so loud blocks and photo heroes are filtered out.",
        slots,
        droppedForBrand: pool.rejected.map((r) => `${r.id}: ${r.why}`),
      };
    }),

  nofun_page_compose: (input) =>
    Effect.gen(function* () {
      const publish = input.publish ?? true;
      // Publishing stores the page in the calling thread (needs its live run); a draft only needs the thread scope.
      const thread = publish
        ? (yield* McpInvocationContext.requireThreadScope(
            (yield* readMutationCaller()).scope,
            "nofun_page_compose",
          )).thread
        : (yield* McpInvocationContext.requireThreadScope(
            yield* McpInvocationContext.McpInvocationContext,
            "nofun_page_compose",
          )).thread;

      if ((input.sections === undefined) === (input.spec === undefined)) {
        return yield* invalid("Pass exactly one of sections or spec.");
      }
      const pool = poolFor(input.brand);
      const composed = yield* Effect.try({
        try: () =>
          input.sections !== undefined
            ? composeFromSections(pool, input.sections)
            : composeFromSpec(pool, parseFlatSpec(input.spec)),
        catch: (error) => invalid(error instanceof Error ? error.message : String(error)),
      });
      const compiled = yield* compile({
        spec: composed.spec,
        brand: pool.brand.id,
        title: input.title,
      });

      const htmlRender = yield* HtmlRender.HtmlRender;
      const appearance = input.appearance ?? "light";
      const shoot = (width: number, label: string) =>
        htmlRender.preview({ html: compiled.html, width, appearance }).pipe(
          Effect.mapError(toFailure),
          Effect.map(({ png, ...p }) => ({ png, p, label })),
        );
      const wide = yield* shoot(1440, "desktop 1440");
      const narrow = yield* shoot(390, "phone 390");

      const reference = publish
        ? yield* htmlRender
            .publish({
              threadId: thread.threadId,
              html: compiled.html,
              title: input.title,
              height: input.height ?? HTML_RENDER_MAX_HEIGHT,
            })
            .pipe(Effect.mapError(toFailure))
        : undefined;

      const features = pageFeatures(composed.spec, pool.brand);
      const checklist = [
        ...CHECKLIST,
        ...(countFlaws(features) > 0
          ? [`Text-level flaws still present after enforcement: ${JSON.stringify(features)}`]
          : []),
      ];
      const missing = [
        ...new Set([...(wide.p.missingImages ?? []), ...(narrow.p.missingImages ?? [])]),
      ];
      return {
        page: {
          brand: pool.brand.id,
          knownBrand: pool.brand.known,
          blocks: composed.blocks,
          enforced: describeReport(composed.report),
          notes: composed.notes,
        },
        published: reference !== undefined,
        ...(reference
          ? {
              htmlRender: {
                ...reference,
                display: input.display ?? ("card" as const),
                autoOpen: input.open ?? true,
              },
            }
          : {}),
        artifact: stats(compiled),
        checklist,
        consoleMessages: [...wide.p.consoleMessages, ...narrow.p.consoleMessages].slice(0, 40),
        ...(missing.length > 0 ? { missingImages: missing } : {}),
        screenshots: [wide, narrow].map(({ png, p, label }) => ({
          label,
          mimeType: "image/png" as const,
          data: png,
          width: p.width,
          height: p.capturedHeight,
          contentHeight: p.contentHeight,
        })),
        message: reference
          ? "Shown to the reader above your reply. Don't describe the page; look at the two screenshots against the checklist and recompose with publish false if something is wrong."
          : "Draft only (not shown to the reader). Fix what the checklist names and call again; publish true (the default) for the final page.",
      };
    }),

  nofun_page_variants: (input) =>
    Effect.gen(function* () {
      const { scope } = yield* readMutationCaller();
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "nofun_page_variants",
      );
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const htmlRender = yield* HtmlRender.HtmlRender;
      const count = Math.min(MAX_VARIANTS, Math.max(1, input.count ?? 6));
      const pool = poolFor(input.brand);
      const purpose = { value: `variants ${pool.brand.id}` };

      const evaluator = yield* Effect.tryPromise({
        try: () => makeEvaluator(stateDir, purpose, REQUEST_BUDGET),
        catch: (e) =>
          e instanceof JevUnavailableError
            ? invalid(e.message)
            : new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: `Jev unavailable: ${e instanceof Error ? e.message : String(e)}`,
              }),
      });

      const composed = yield* Effect.forEach(
        Array.from({ length: count }, (_, i) => i),
        (i) =>
          Effect.tryPromise({
            try: () => {
              purpose.value = `compose ${pool.brand.id} v${i + 1}`;
              return composeVariant(pool, input.brief, i, evaluator.evaluate);
            },
            catch: (e) => String(e instanceof Error ? e.message : e).slice(0, 200),
          }).pipe(Effect.result),
        { concurrency: CONCURRENCY },
      );
      const pages: Variant[] = [];
      let firstError: string | undefined;
      for (const r of composed) {
        if (r._tag === "Failure") firstError ??= r.failure;
        else if (r.success) pages.push(r.success);
      }
      if (pages.length === 0) {
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: `Jev returned no pages${firstError ? `: ${firstError}` : ""}. Compose the page yourself with nofun_page_compose.`,
        });
      }

      // One judge request per 10 pages; a failed judge keeps the pages unjudged rather than losing them.
      const judged: Record<string, Judged> = {};
      for (let i = 0; i < pages.length; i += 10) {
        const chunk = pages.slice(i, i + 10).map((p) => ({ id: `v${p.index + 1}`, spec: p.spec }));
        purpose.value = `judge ${pool.brand.id} ${i + 1}-${i + chunk.length}`;
        const res = yield* Effect.tryPromise({
          try: () => judgePages(pool, chunk, evaluator.evaluate),
          catch: (e) => String(e),
        }).pipe(Effect.result);
        if (res._tag === "Success") Object.assign(judged, res.success);
      }
      const unjudged: Judged = { verdict: null, confidence: null, score: 0 };
      const judgeRan = Object.keys(judged).length > 0;
      const rows = pages.map((p) => ({
        p,
        id: `v${p.index + 1}`,
        j: judged[`v${p.index + 1}`] ?? unjudged,
      }));
      const survivors = rows
        .filter((r) => !judgeRan || !isWeak(r.j))
        .sort((a, b) => b.j.score - a.j.score);
      const dropped = rows.filter((r) => !survivors.includes(r));

      const variants = yield* Effect.forEach(
        survivors,
        ({ p, id, j }) =>
          Effect.gen(function* () {
            const base = {
              id,
              blocks: p.blocks.join(" > "),
              verdict: j.verdict,
              confidence: j.confidence,
              flaws: p.flaws,
            };
            const title = `${pool.brand.id} variant ${id}`.slice(0, 80);
            const res = yield* compile({ spec: p.spec, brand: pool.brand.id, title }).pipe(
              Effect.flatMap((compiled) =>
                htmlRender
                  .publish({
                    threadId: thread.threadId,
                    html: compiled.html,
                    title,
                    height: HTML_RENDER_MAX_HEIGHT,
                  })
                  .pipe(Effect.mapError(toFailure)),
              ),
              Effect.result,
            );
            return res._tag === "Success"
              ? {
                  ...base,
                  htmlRender: { ...res.success, display: "card" as const, autoOpen: false },
                }
              : { ...base, error: res.failure.message };
          }),
        { concurrency: 2 },
      );

      const table = [
        "id | verdict | flaws | blocks",
        ...survivors.map(
          ({ p, id, j }) =>
            `${id} | ${j.verdict ?? "unjudged"} | ${p.flaws} | ${p.blocks.join(" > ")}`,
        ),
      ].join("\n");
      return {
        brand: pool.brand.id,
        requests: evaluator.requestsUsed(),
        variants,
        dropped: dropped.map(({ p, id, j }) => ({
          id,
          blocks: p.blocks.join(" > "),
          verdict: j.verdict,
        })),
        summary: table,
        message:
          "The survivors are shown as closed cards above your reply. The judge saw block order and tags only. Screenshot your pick with nofun_page_compose (sections from its blocks, publish false) before recommending it.",
      };
    }),
} satisfies Parameters<typeof NofunPageToolkit.toLayer>[0];

const layerCatalogHandlers = NofunPageCatalogToolkit.toLayer({
  nofun_page_catalog: handlers.nofun_page_catalog,
});
const layerComposeHandlers = NofunPageComposeToolkit.toLayer({
  nofun_page_compose: handlers.nofun_page_compose,
});
const layerVariantsHandlers = NofunPageVariantsToolkit.toLayer({
  nofun_page_variants: handlers.nofun_page_variants,
});

const isOrchestratorMcpFailure = Schema.is(OrchestratorMcpFailure);

interface ComposeResult {
  readonly screenshots: ReadonlyArray<{
    readonly label: string;
    readonly mimeType: "image/png";
    readonly data: string;
    readonly width: number;
    readonly height: number;
  }>;
  readonly [key: string]: unknown;
}

/**
 * McpServer.toolkit serializes results as JSON text, and registerImageTool carries exactly one image. The compose
 * tool returns two (1440 and 390 wide), so it registers by hand: the PNGs go out as image blocks, the rest as JSON.
 */
const registerCompose = Effect.fn("McpHttpServer.registerNofunPageCompose")(function* () {
  const htmlRender = yield* HtmlRender.HtmlRender;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const built = yield* NofunPageComposeToolkit;
  const server = yield* McpServer.McpServer;
  const tool = NofunPageComposeTool;
  const failureResult = (text: string) =>
    new McpSchema.CallToolResult({
      isError: true,
      structuredContent: { error: { message: text } },
      content: [{ type: "text", text }],
    });
  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: Tool.getJsonSchema(tool),
      annotations: {
        title: "Compose No Fun page",
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      },
    }),
    annotations: tool.annotations,
    handle: (payload) =>
      Effect.withFiber((fiber) => {
        const invocation = Context.getUnsafe(
          fiber.context,
          McpInvocationContext.McpInvocationContext,
        );
        return built.handle(tool.name, payload as never).pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideService(HtmlRender.HtmlRender, htmlRender),
          Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.matchCauseEffect({
            onFailure: (cause) => {
              if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason))
                return Effect.failCause(cause).pipe(Effect.orDie);
              const first = cause.reasons.find(Cause.isFailReason)?.error;
              const text =
                isOrchestratorMcpFailure(first) || AiError.isAiError(first)
                  ? first.message
                  : "No Fun page compose failed.";
              return Effect.succeed(failureResult(text));
            },
            onSuccess: ({ encodedResult }) => {
              const { screenshots, ...rest } = encodedResult as ComposeResult;
              const metadata = {
                ...rest,
                screenshots: screenshots.map(({ data: _data, ...meta }) => meta),
              };
              return Effect.succeed(
                new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent: metadata,
                  content: [
                    { type: "text", text: JSON.stringify(metadata) },
                    ...screenshots.map((s) => ({
                      type: "image" as const,
                      data: new Uint8Array(Buffer.from(s.data, "base64")),
                      mimeType: s.mimeType,
                    })),
                  ],
                }),
              );
            },
          }),
        );
      }),
  });
});

/** The No Fun page tools: catalog, compose (two screenshots) and the optional Jev variants. */
export const makeLayer = () =>
  Layer.mergeAll(
    McpServer.toolkit(NofunPageCatalogToolkit).pipe(Layer.provide(layerCatalogHandlers)),
    McpServer.toolkit(NofunPageVariantsToolkit).pipe(Layer.provide(layerVariantsHandlers)),
    Layer.effectDiscard(registerCompose()).pipe(Layer.provide(layerComposeHandlers)),
  ).pipe(Layer.provide(HtmlRender.layer));
