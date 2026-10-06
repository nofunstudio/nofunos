import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { HTML_RENDER_MAX_HEIGHT, HTML_RENDER_MAX_TITLE_LENGTH } from "@t3tools/shared/htmlRender";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import { SLOTS } from "../../../nofun/pages/candidates.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const NOFUN_PAGE_CATALOG_TOOL_NAME = "nofun_page_catalog";
export const NOFUN_PAGE_COMPOSE_TOOL_NAME = "nofun_page_compose";
export const NOFUN_PAGE_VARIANTS_TOOL_NAME = "nofun_page_variants";

const PAGE_GUIDE = `Pages are built from No Fun commerce blocks in SLOTS, top to bottom: ${SLOTS.join(", ")}. A section entry is either a slot name (the first block in that slot that suits the brand) or a block id from nofun_page_catalog. Rules enforced in code, whoever chooses the sections: one nav first (an announcement bar may precede it), one hero right after it, one buying section, at most one loud divider, at least 3 and at most 9 content sections, one footer last. The brand filter drops blocks that cannot suit the brand (a loud divider on a calm brand, a photo hero where the brand has no photo, an empty outline box).`;

const HtmlReference = Schema.Struct({
  attachmentId: Schema.String,
  title: Schema.String,
  height: Schema.Number,
  heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
  display: Schema.optional(Schema.Literals(["inline", "card"])),
  autoOpen: Schema.optional(Schema.Boolean),
});

const DisplayInput = {
  display: Schema.optional(
    Schema.Literals(["inline", "card"]).annotate({
      description:
        'How the thread shows the page. Defaults to "card" (a titled card the reader opens).',
    }),
  ),
  open: Schema.optional(
    Schema.Boolean.annotate({
      description: "Open the page in the side panel when it first appears. Defaults to true.",
    }),
  ),
};

// ---- nofun_page_catalog ----

export const NofunPageCatalogTool = Tool.make(NOFUN_PAGE_CATALOG_TOOL_NAME, {
  description: `List the blocks a No Fun page can be composed from: slots, block ids, one-line descriptions, and which survive the brand filter. Call it before nofun_page_compose when you do not know the block ids. Pass the brand for the filtered list; without it the list is for a neutral calm brand. ${PAGE_GUIDE}`,
  parameters: Schema.Struct({
    brand: Schema.optional(
      Schema.String.annotate({
        description:
          "Brand slug or name, e.g. hardline, hoopla, mesa-form, ace-row, smudge-club. Other names get a neutral calm profile.",
      }),
    ),
  }),
  success: Schema.Struct({
    brand: Schema.String,
    knownBrand: Schema.Boolean,
    brandNote: Schema.String,
    slots: Schema.Record(Schema.String, Schema.Array(Schema.String)),
    droppedForBrand: Schema.Array(Schema.String),
    playbook: Schema.optional(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "No Fun page catalog")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

// ---- nofun_page_compose ----

export const NofunPageComposeTool = Tool.make(NOFUN_PAGE_COMPOSE_TOOL_NAME, {
  description: `Compose a No Fun landing page from blocks, check it, and (by default) show it. You are the page author: pick the sections, the tool enforces the rules, compiles and screenshots the page at 1440 and 390 pixels wide and returns both images with a checklist. Look at the images and fix what the checklist names (clipped headline, empty block, low-contrast hero title, repeated products), then call again. Pass publish false while iterating so only the final page lands in the thread. Give exactly one of sections (slot names or block ids) or spec (a full flat json-render spec {root, elements}). ${PAGE_GUIDE}`,
  parameters: Schema.Struct({
    brand: Schema.String.annotate({
      description:
        "Brand slug or name. Known brands: hardline, hoopla, mesa-form, ace-row, smudge-club; others get a neutral calm profile.",
    }),
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH),
    ).annotate({ description: "Short name for the page." }),
    sections: Schema.optional(
      Schema.Array(Schema.String).check(Schema.isMaxLength(24)).annotate({
        description:
          'Ordered section entries, e.g. ["announcement", "nav", "hero-type-center", "featured", "manifesto", "press", "div-marquee", "cta", "footer"]. Nav and footer are added if missing.',
      }),
    ),
    spec: Schema.optional(
      Schema.Unknown.annotate({
        description:
          'A full flat json-render spec: {"root": "page", "elements": {"page": {"type": "Page", "props": {}, "children": ["nav"]}, "nav": {"type": "SiteNav", "props": {"variant": "minimal", "cartCount": 1}, "children": []}}}.',
      }),
    ),
    publish: Schema.optional(
      Schema.Boolean.annotate({
        description:
          "Show the page in the thread. Defaults to true. Pass false for draft iterations: you still get the screenshots.",
      }),
    ),
    appearance: Schema.optional(
      Schema.Literals(["dark", "light"]).annotate({
        description: "Reader light/dark mode to preview. Defaults to light.",
      }),
    ),
    height: Schema.optional(
      Schema.Int.annotate({
        description: `Frame height cap in CSS pixels. Omit to fit the page (max ${HTML_RENDER_MAX_HEIGHT}).`,
      }),
    ),
    ...DisplayInput,
  }),
  success: Schema.Struct({
    page: Schema.Struct({
      brand: Schema.String,
      knownBrand: Schema.Boolean,
      blocks: Schema.Array(Schema.String),
      enforced: Schema.NullOr(Schema.String),
      notes: Schema.Array(Schema.String),
    }),
    published: Schema.Boolean,
    htmlRender: Schema.optional(HtmlReference),
    artifact: Schema.Struct({
      theme: Schema.String,
      lane: Schema.String,
      bytes: Schema.Int,
      compileMs: Schema.Int,
    }),
    checklist: Schema.Array(Schema.String),
    consoleMessages: Schema.Array(
      Schema.Struct({
        level: Schema.Literals(["log", "info", "warning", "error"]),
        text: Schema.String,
      }),
    ),
    missingImages: Schema.optional(Schema.Array(Schema.String)),
    // Every screenshot, in order: 1440 wide, then 390 wide. They go out as image blocks, not JSON.
    screenshots: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        mimeType: Schema.Literal("image/png"),
        data: Schema.String,
        width: Schema.Int,
        height: Schema.Int,
        contentHeight: Schema.Int,
      }),
    ),
    message: Schema.String,
    playbook: Schema.optional(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    HtmlRender.HtmlRender,
  ],
})
  .annotate(Tool.Title, "Compose No Fun page")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

// ---- nofun_page_variants (Jev) ----

export const NofunPageVariantsTool = Tool.make(NOFUN_PAGE_VARIANTS_TOOL_NAME, {
  description: `Fast, cheap page variants: Jev (a small selection model) composes up to 12 pages from the brand's blocks, the same rules are enforced in code, one text-only judge call per 10 pages drops the weak ones, and the survivors come back as closed cards with a summary table (brand, blocks in order, verdict). The judge sees block order and tags, not pixels: it removes the worst pages, it does not pick winners. Look at screenshots (nofun_page_compose with the chosen sections, publish false) before recommending one. Variants repeat the first-listed block of a slot less than they would, but Jev adds judgement of fit, not creativity; for a considered page, compose it yourself. Needs the Jev gateway key; without it this tool returns an error and the rest still works.`,
  parameters: Schema.Struct({
    brand: Schema.String.annotate({ description: "Brand slug or name." }),
    brief: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)).annotate({
      description: "One or two sentences on what the page is for and its mood.",
    }),
    count: Schema.optional(
      Schema.Int.annotate({ description: "How many variants to compose, 1-12. Defaults to 6." }),
    ),
  }),
  success: Schema.Struct({
    brand: Schema.String,
    requests: Schema.Int,
    variants: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        blocks: Schema.String,
        verdict: Schema.NullOr(Schema.String),
        confidence: Schema.NullOr(Schema.Number),
        flaws: Schema.Int,
        htmlRender: Schema.optional(HtmlReference),
        error: Schema.optional(Schema.String),
      }),
    ),
    dropped: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        blocks: Schema.String,
        verdict: Schema.NullOr(Schema.String),
      }),
    ),
    // Every published variant in order, so clients can show one card per variant.
    htmlRenders: Schema.optional(Schema.Array(HtmlReference)),
    summary: Schema.String,
    message: Schema.String,
    playbook: Schema.optional(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    HtmlRender.HtmlRender,
    ServerConfig.ServerConfig,
  ],
})
  .annotate(Tool.Title, "No Fun page variants")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const NofunPageCatalogToolkit = Toolkit.make(NofunPageCatalogTool);
export const NofunPageComposeToolkit = Toolkit.make(NofunPageComposeTool);
export const NofunPageVariantsToolkit = Toolkit.make(NofunPageVariantsTool);

export const NofunPageToolkit = Toolkit.make(
  NofunPageCatalogTool,
  NofunPageComposeTool,
  NofunPageVariantsTool,
);
