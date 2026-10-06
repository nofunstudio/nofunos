import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { compileArtifact, ArtifactCompileError } from "@t3tools/nofun-artifacts/compiler";
import { HTML_RENDER_MAX_HEIGHT } from "@t3tools/shared/htmlRender";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import { makeEvaluator, JevUnavailableError } from "../../../nofun/pages/jev.ts";
import {
  bundleSections,
  deterministicOrders,
  enforceOrder,
  jevOrder,
  type PrototypeSection,
} from "../../../nofun/prototype.ts";
import {
  listReferences,
  markPlaybookLoaded,
  playbookFor,
  readPlaybook,
  readReference,
} from "../../../nofun/playbook.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { readMutationCaller } from "../../threadAccess.ts";
import {
  NofunArtifactPrototypeToolkit,
  NofunDesignGuideToolkit,
  PROTOTYPE_TITLE_MAX,
} from "./guideTools.ts";

const MAX_VARIANTS = 8;
const CONCURRENCY = 3;

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const layerGuideHandlers = NofunDesignGuideToolkit.toLayer({
  nofun_design_guide: (input) =>
    Effect.gen(function* () {
      const caller = yield* McpInvocationContext.McpInvocationContext;
      const references = listReferences();
      const name = input.reference?.trim();
      const content = name ? readReference(name) : readPlaybook();
      if (content === undefined) {
        return yield* invalid(
          name
            ? `No reference "${name}". Available: ${references.join(", ") || "none"}.`
            : "The No Fun artifact playbook is not available on this machine.",
        );
      }
      if (!name) markPlaybookLoaded(caller);
      return { reference: name || "playbook", content, references };
    }),
});

const layerPrototypeHandlers = NofunArtifactPrototypeToolkit.toLayer({
  nofun_artifact_prototype: (input) =>
    Effect.gen(function* () {
      const { scope } = yield* readMutationCaller();
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "nofun_artifact_prototype",
      );
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const htmlRender = yield* HtmlRender.HtmlRender;
      const sections: PrototypeSection[] = input.candidates.map((c) => ({
        id: c.id,
        title: c.title,
        role: c.role?.trim().toLowerCase() || undefined,
        tsx: c.tsx,
      }));
      const ids = new Set(sections.map((s) => s.id));
      if (ids.size !== sections.length) return yield* invalid("Candidate ids must be unique.");
      const required = input.sections ?? [];
      const unknown = required.filter((id) => !ids.has(id));
      if (unknown.length > 0) {
        return yield* invalid(`sections names unknown candidate ids: ${unknown.join(", ")}.`);
      }
      const count = Math.min(MAX_VARIANTS, Math.max(1, input.count ?? 4));

      // Jev picks the orders; its absence (or a failure) falls back to the deterministic rhythm.
      const purpose = { value: "prototype" };
      const evaluator = yield* Effect.tryPromise({
        try: () => makeEvaluator(stateDir, purpose, 6 + count * 3),
        catch: (e) => (e instanceof JevUnavailableError ? e.message : String(e)),
      }).pipe(Effect.result);
      const orders: string[][] = [];
      const seen = new Set<string>();
      const add = (order: string[]) => {
        const key = order.join("|");
        if (!seen.has(key)) (seen.add(key), orders.push(order));
      };
      let jevCount = 0;
      if (evaluator._tag === "Success") {
        const picked = yield* Effect.forEach(
          Array.from({ length: count }, (_, i) => i),
          (i) =>
            Effect.tryPromise({
              try: () => {
                purpose.value = `prototype v${i + 1}`;
                return jevOrder(sections, input.brief, i, evaluator.success.evaluate);
              },
              catch: (e) => String(e instanceof Error ? e.message : e).slice(0, 200),
            }).pipe(Effect.result),
          { concurrency: CONCURRENCY },
        );
        for (const r of picked)
          if (r._tag === "Success" && r.success) add(enforceOrder(r.success, sections, required));
        jevCount = orders.length;
      }
      if (orders.length < count) {
        for (const o of deterministicOrders(sections, count + orders.length, required)) {
          if (orders.length >= count) break;
          add(o);
        }
      }
      const composer = jevCount === 0 ? "rhythm" : jevCount >= orders.length ? "jev" : "jev+rhythm";

      const byId = new Map(sections.map((s) => [s.id, s]));
      const variants = yield* Effect.forEach(
        orders.map((order, i) => ({ order, n: i + 1 })),
        ({ order, n }) =>
          Effect.gen(function* () {
            const sectionsText = order.join(" > ");
            const title = `${input.brief} v${n}`.slice(0, PROTOTYPE_TITLE_MAX);
            const res = yield* Effect.tryPromise({
              try: async () => {
                const tsx = bundleSections(order.map((id) => byId.get(id)!));
                return compileArtifact({ tsx, theme: input.theme, title });
              },
              catch: (e) =>
                e instanceof ArtifactCompileError || e instanceof Error ? e.message : String(e),
            }).pipe(
              Effect.flatMap((compiled) =>
                htmlRender
                  .publish({
                    threadId: thread.threadId,
                    html: compiled.html,
                    title,
                    height: HTML_RENDER_MAX_HEIGHT,
                  })
                  .pipe(Effect.mapError((e) => e.message)),
              ),
              Effect.result,
            );
            return res._tag === "Success"
              ? {
                  variant: n,
                  sections: sectionsText,
                  htmlRender: { ...res.success, display: "card" as const, autoOpen: false },
                }
              : { variant: n, sections: sectionsText, error: String(res.failure).slice(0, 600) };
          }),
        { concurrency: 2 },
      );

      const first = variants.find((v) => "htmlRender" in v && v.htmlRender);
      if (!first) {
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: `No layout compiled: ${variants[0]?.error ?? "unknown error"}`,
        });
      }
      const table = [
        "variant | sections",
        ...variants.map((v) => `${v.variant} | ${v.sections}${v.error ? " (failed)" : ""}`),
      ].join("\n");
      return {
        composer,
        variants,
        ...("htmlRender" in first && first.htmlRender ? { htmlRender: first.htmlRender } : {}),
        htmlRenders: variants.flatMap((v) =>
          "htmlRender" in v && v.htmlRender ? [v.htmlRender] : [],
        ),
        requests: evaluator._tag === "Success" ? evaluator.success.requestsUsed() : 0,
        summary: table,
        message:
          composer === "rhythm"
            ? `Jev was unavailable${evaluator._tag === "Failure" ? ` (${String(evaluator.failure).slice(0, 160)})` : ""}, so these are deterministic role-based orderings. Layouts are published as closed cards (the thread shows every variant as a card). Pick one, then refine it with nofun_artifact_preview and nofun_artifact_render.`
            : "Layouts are published as closed cards (the thread shows every variant as a card). Pick one, then refine it with nofun_artifact_preview and nofun_artifact_render.",
        ...playbookFor({ thread }),
      };
    }),
});

/** The design guide and the Jev-assisted prototype tool. */
export const makeLayer = () =>
  Layer.mergeAll(
    McpServer.toolkit(NofunDesignGuideToolkit).pipe(Layer.provide(layerGuideHandlers)),
    McpServer.toolkit(NofunArtifactPrototypeToolkit).pipe(Layer.provide(layerPrototypeHandlers)),
  ).pipe(Layer.provide(HtmlRender.layer));
