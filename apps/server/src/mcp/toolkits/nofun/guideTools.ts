import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { HTML_RENDER_MAX_TITLE_LENGTH } from "@t3tools/shared/htmlRender";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const NOFUN_DESIGN_GUIDE_TOOL_NAME = "nofun_design_guide";
export const NOFUN_ARTIFACT_PROTOTYPE_TOOL_NAME = "nofun_artifact_prototype";

export const NofunDesignGuideTool = Tool.make(NOFUN_DESIGN_GUIDE_TOOL_NAME, {
  description:
    'The No Fun artifact playbook (rules for every visual) or one of its references ("go-to-components", "patterns", "tsx-lane", ...). The first nofun_* call in a thread already carries the playbook; call this to re-read it or to open a reference. Omit `reference` for the playbook itself; the result lists the available references.',
  parameters: Schema.Struct({
    reference: Schema.optional(
      Schema.String.check(Schema.isMaxLength(64)).annotate({
        description: "A reference name from the `references` list. Omit for the playbook.",
      }),
    ),
  }),
  success: Schema.Struct({
    reference: Schema.String,
    content: Schema.String,
    references: Schema.Array(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "No Fun design guide")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const PrototypeCandidate = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)).annotate({
    description: "Unique id, e.g. kpis, revenue-chart.",
  }),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  role: Schema.optional(
    Schema.String.check(Schema.isMaxLength(24)).annotate({
      description:
        'header, metrics, chart, table, story, media, cta, footer, or your own. A "header" always goes first and a "footer" last.',
    }),
  ),
  tsx: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(30_000)).annotate({
    description:
      "A self-contained TSX section component with real content. It must `export default` a component that takes no props; same import rules as nofun_artifact_render.",
  }),
});

export const NofunArtifactPrototypeTool = Tool.make(NOFUN_ARTIFACT_PROTOTYPE_TOOL_NAME, {
  description:
    "Fast first-iteration variants. You write 3-24 self-contained TSX section components with real content; Jev (or, if it is unavailable, a role-based rhythm) chooses and orders them into up to 8 different page layouts, enforced in code (header first, footer last, at least 3 sections, no duplicates). Each layout is compiled and published as a closed card; a table lists the sections in order. Pick one, then refine it with nofun_artifact_preview and nofun_artifact_render. Jev only orders what you wrote; it adds no content.",
  parameters: Schema.Struct({
    brief: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)).annotate({
      description: "One or two sentences on what the page is for and its mood.",
    }),
    theme: Schema.optional(
      Schema.String.check(Schema.isMaxLength(64)).annotate({
        description: "No Fun brand id or t3. Defaults to kobra.",
      }),
    ),
    candidates: Schema.Array(PrototypeCandidate).check(
      Schema.isMinLength(3),
      Schema.isMaxLength(24),
    ),
    count: Schema.optional(
      Schema.Int.annotate({ description: "Layouts to make, 1-8. Default 4." }),
    ),
    sections: Schema.optional(
      Schema.Array(Schema.String).annotate({
        description: "Candidate ids that every layout must include. Others are optional.",
      }),
    ),
  }),
  success: Schema.Struct({
    composer: Schema.Literals(["jev", "jev+rhythm", "rhythm"]),
    variants: Schema.Array(
      Schema.Struct({
        variant: Schema.Int,
        sections: Schema.String,
        htmlRender: Schema.optional(
          Schema.Struct({
            attachmentId: Schema.String,
            title: Schema.String,
            height: Schema.Number,
            heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
            display: Schema.optional(Schema.Literals(["inline", "card"])),
            autoOpen: Schema.optional(Schema.Boolean),
          }),
        ),
        error: Schema.optional(Schema.String),
      }),
    ),
    // The first published layout, so clients that show one card per tool call show variant 1.
    htmlRender: Schema.optional(
      Schema.Struct({
        attachmentId: Schema.String,
        title: Schema.String,
        height: Schema.Number,
        heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
        display: Schema.optional(Schema.Literals(["inline", "card"])),
        autoOpen: Schema.optional(Schema.Boolean),
      }),
    ),
    requests: Schema.Int,
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
  .annotate(Tool.Title, "No Fun artifact prototype")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const NofunDesignGuideToolkit = Toolkit.make(NofunDesignGuideTool);
export const NofunArtifactPrototypeToolkit = Toolkit.make(NofunArtifactPrototypeTool);

export const PROTOTYPE_TITLE_MAX = HTML_RENDER_MAX_TITLE_LENGTH;
