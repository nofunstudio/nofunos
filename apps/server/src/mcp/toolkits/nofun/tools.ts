import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  ARTIFACT_THEME_IDS,
  artifactCatalogGuide,
  artifactThemeGuide,
} from "@t3tools/nofun-artifacts/compiler";
import {
  HTML_RENDER_COLUMN_WIDTH,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MAX_TITLE_LENGTH,
  HTML_RENDER_MIN_HEIGHT,
} from "@t3tools/shared/htmlRender";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const NOFUN_ARTIFACT_RENDER_TOOL_NAME = "nofun_artifact_render";
export const NOFUN_ARTIFACT_PREVIEW_TOOL_NAME = "nofun_artifact_preview";

const SPEC_EXAMPLE = JSON.stringify({
  root: {
    component: "Stack",
    children: [
      { component: "Text", props: { variant: "title", text: "Week 40" } },
      {
        component: "Grid",
        props: { columns: 3 },
        children: [
          {
            component: "Metric",
            props: {
              label: "Revenue",
              value: 48210,
              format: "currency",
              change: 12.4,
              trend: [31, 38, 44, 48],
            },
          },
        ],
      },
      {
        component: "Chart",
        props: {
          type: "bar",
          title: "Orders",
          xKey: "week",
          series: [{ key: "orders", label: "Orders" }],
          data: [
            { week: "W39", orders: 1210 },
            { week: "W40", orders: 1284 },
          ],
        },
      },
    ],
  },
});

const TSX_EXAMPLE = `import { useState } from "react"; import { Stack, Button, DataTable } from "@nofun/artifacts"; const ROWS = [...]; export default function App() { const [only, setOnly] = useState(false); return <Stack><Button size="sm" onClick={() => setOnly(!only)}>Open only</Button><DataTable columns={[...]} rows={only ? ROWS.filter((r) => r.open) : ROWS} /></Stack>; }`;

export const NOFUN_ARTIFACT_GUIDE = [
  "Builds a No Fun artifact from the real No Fun component library (Kobra primitives and No Fun blocks) and a No Fun theme, as one self-contained page. Text stays primary: use it only when a dashboard, chart, table, comparison, timeline or gallery says more than prose, and only with real data you read from tools or the user. Never invent metrics, progress or verification badges.",
  `Two lanes, pass exactly one. spec: a JSON object {"root": node}, node = {"component", "props", "children"?}. Components (* = required prop):\n${artifactCatalogGuide()}\nExample spec: ${SPEC_EXAMPLE}`,
  `tsx: custom React when the catalog would force a worse result (custom layout, interaction). It must \`export default\` a component and may import only "react" and "@nofun/artifacts", which exports the ten components above plus the Kobra primitives Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Button (variant default|outline|secondary|ghost, size default|sm|xs), Input, Table parts, Kpi parts, TrendChip, NumberValue, Sparkline, ChartFrame/ChartPlot, Separator, Skeleton, Empty parts, cn and formatNumberValue. Style with Tailwind classes on the theme tokens (bg-card, text-muted-foreground, border-border, bg-accent-brand, rounded-brand, micro, display-m); no other imports, no network calls. Example: ${TSX_EXAMPLE}`,
  `theme: ${artifactThemeGuide()} Default kobra. The theme only styles the page; it never changes the account or thread. The page follows the reader's light/dark mode.`,
  "Unknown components, props or imports fail with a message naming each problem and its path; fix and call again.",
].join("\n\n");

const ArtifactInput = {
  spec: Schema.optional(
    Schema.Unknown.annotate({
      description:
        'A catalog spec object: {"root": {"component": "Stack", "props": {...}, "children": [...]}}.',
    }),
  ),
  tsx: Schema.optional(
    Schema.String.check(Schema.isMaxLength(100_000)).annotate({
      description:
        'Custom React TSX that `export default`s a component and imports only "react" and "@nofun/artifacts".',
    }),
  ),
  theme: Schema.optional(
    Schema.Literals(ARTIFACT_THEME_IDS).annotate({
      description: "No Fun theme. Defaults to kobra.",
    }),
  ),
};

const ArtifactStats = Schema.Struct({
  theme: Schema.String,
  lane: Schema.Literals(["spec", "tsx"]),
  bytes: Schema.Int,
  compileMs: Schema.Int,
});

export const NofunArtifactPreviewTool = Tool.make(NOFUN_ARTIFACT_PREVIEW_TOOL_NAME, {
  description: `Compile a No Fun artifact and screenshot it in T3's headless browser: returns a PNG, contentHeight and the page's console output, like html_preview. Check every artifact here before nofun_artifact_render; fix clipping, empty states, unreadable labels and console errors first.\n\n${NOFUN_ARTIFACT_GUIDE}`,
  parameters: Schema.Struct({
    ...ArtifactInput,
    title: Schema.optional(Schema.String.check(Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH))),
    width: Schema.optional(
      Schema.Int.annotate({
        description: `Viewport width in CSS pixels, 240-1600. Defaults to ${HTML_RENDER_COLUMN_WIDTH}; use about 390 to check phones.`,
      }),
    ),
    appearance: Schema.optional(
      Schema.Literals(["dark", "light"]).annotate({
        description: "Reader light/dark mode to preview. Defaults to dark.",
      }),
    ),
  }),
  success: Schema.Struct({
    width: Schema.Int,
    contentHeight: Schema.Int,
    capturedHeight: Schema.Int,
    consoleMessages: Schema.Array(
      Schema.Struct({
        level: Schema.Literals(["log", "info", "warning", "error"]),
        text: Schema.String,
      }),
    ),
    missingImages: Schema.optional(Schema.Array(Schema.String)),
    artifact: ArtifactStats,
    screenshot: Schema.Struct({
      mimeType: Schema.Literal("image/png"),
      data: Schema.String,
      width: Schema.Int,
      height: Schema.Int,
    }),
  }),
  failure: OrchestratorMcpFailure,
  dependencies: [McpInvocationContext.McpInvocationContext, HtmlRender.HtmlRender],
})
  .annotate(Tool.Title, "Preview No Fun artifact")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

// Publishes through HtmlRender.publish, the same store html_render uses, and returns the same
// `htmlRender` reference, so every client shows it inline like any HTML render.
export const NofunArtifactRenderTool = Tool.make(NOFUN_ARTIFACT_RENDER_TOOL_NAME, {
  description: `Compile a No Fun artifact and show it inline in this thread, above your final text reply, exactly like html_render (call it before writing that reply; don't announce or restate the page). Preview with nofun_artifact_preview first. Same inputs as the preview.\n\n${NOFUN_ARTIFACT_GUIDE}`,
  parameters: Schema.Struct({
    ...ArtifactInput,
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH),
    ).annotate({ description: "Short name for the artifact." }),
    height: Schema.optional(
      Schema.Int.annotate({
        description: `Frame height cap in CSS pixels, ${HTML_RENDER_MIN_HEIGHT}-${HTML_RENDER_MAX_HEIGHT}. Omit to fit the page; pass less than the preview's contentHeight to make it scroll.`,
      }),
    ),
  }),
  success: Schema.Struct({
    htmlRender: Schema.Struct({
      attachmentId: Schema.String,
      title: Schema.String,
      height: Schema.Number,
      heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
    }),
    artifact: ArtifactStats,
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    HtmlRender.HtmlRender,
  ],
})
  .annotate(Tool.Title, "Render No Fun artifact")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const NofunArtifactPreviewToolkit = Toolkit.make(NofunArtifactPreviewTool);

export const NofunArtifactRenderToolkit = Toolkit.make(NofunArtifactRenderTool);

export const NofunArtifactToolkit = Toolkit.make(NofunArtifactPreviewTool, NofunArtifactRenderTool);
