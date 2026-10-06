# No Fun artifact catalog

Every component here wraps real source in the live `nofun-components` checkout (`NOFUN_COMPONENTS_DIR`), compiled on each call; nothing is snapshotted. Paths are relative to that repo. Props and validation live in `src/catalog.ts`.

## Semantic components (spec lane and `@nofun/artifacts`)

| Component  | Built from                                                                                                                                   | Port notes                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Stack      | New layout wrapper                                                                                                                           | No Fun lays out with raw Tailwind flex; this only maps `gap` to tokens.                                                       |
| Grid       | New layout wrapper                                                                                                                           | Balances columns so a card never sits alone on the last row.                                                                  |
| Text       | `registry/nofun-ui/themes/base.css` (`display-m`, `micro`, display transform and weight)                                                     | Variants: display, title, heading, body, muted, micro.                                                                        |
| Metric     | `registry/nofun-ui/blocks/charts/kpi/kpi.tsx`, `charts/trend-chip/trend-chip.tsx`, `charts/sparkline/sparkline.tsx`, `charts/number-value/*` | KPI card parts verbatim. KpiChart, KpiProgress and KpiSkeleton are left out.                                                  |
| Status     | `components/ui/badge.tsx` plus the tone map in `blocks/data/timeline/timeline.tsx`                                                           | Badge with a dot.                                                                                                             |
| DataTable  | `components/ui/table.tsx`, sort header from `blocks/data/data-grid/data-grid.tsx`, `components/ui/input.tsx`                                 | Sorting and filtering run in the page. TanStack, dnd-kit and pagination are not ported.                                       |
| Chart      | `blocks/charts/chart-bar/chart-bar.tsx`, `blocks/charts/chart-area/chart-shell.tsx`, tooltip markup from `components/ui/chart.tsx`           | Recharts is replaced by a small SVG renderer with the same quiet axes, nice ticks, tone order, bar geometry and tooltip look. |
| Gallery    | `blocks/gallery/caption-mosaic/caption-mosaic.tsx`                                                                                           | Photo tiles on the brand radius with the accent caption tile. The inverted text panel and lookbook asides are left out.       |
| Comparison | `blocks/product/compare-table/compare-table.tsx`                                                                                             | Takes any columns instead of commerce products. Adds a "Differences only" toggle.                                             |
| Timeline   | `blocks/data/timeline/timeline.tsx`                                                                                                          | All parts verbatim. Base UI `useRender` is replaced by `<li>`.                                                                |

## Kobra primitives (custom TSX only)

| Export                                                                            | Source                        | Port notes                                                                               |
| --------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter | `components/ui/card.tsx`      | Verbatim.                                                                                |
| Table parts                                                                       | `components/ui/table.tsx`     | Verbatim.                                                                                |
| Empty parts                                                                       | `components/ui/empty.tsx`     | Verbatim.                                                                                |
| Skeleton                                                                          | `components/ui/skeleton.tsx`  | Verbatim.                                                                                |
| Badge                                                                             | `components/ui/badge.tsx`     | Variant classes verbatim. Base UI `useRender` is replaced by `<span>`.                   |
| Button                                                                            | `components/ui/button.tsx`    | Base, variant and size classes verbatim. No `push` variant, renders a native `<button>`. |
| Input                                                                             | `components/ui/input.tsx`     | Classes verbatim, native `<input>`.                                                      |
| Separator                                                                         | `components/ui/separator.tsx` | Same classes on a `div role=separator`.                                                  |
| Kpi parts, TrendChip, NumberValue, Sparkline, ChartFrame/ChartPlot                | As in the table above         | `NumberValue` drops the digit-flip animation.                                            |

Icons are inline SVG stand-ins for the Tabler glyphs the blocks use, on the same 24px grid and 2px stroke.

## Styles

| File                                      | Source                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/styles/kobra-theme.css`              | `app/globals.css` lines 7-170: the dark variant and the Kobra `@theme inline` token map                    |
| `src/styles/nofun-base.css`               | `registry/nofun-ui/themes/base.css`, verbatim                                                              |
| `src/styles/kobra-surface.css`            | `app/globals.css` lines 562-802: the `.t-surface` paint that Badge and Button use                          |
| `src/styles/themes/kobra.css`, `mrch.css` | `registry/nofun-ui/themes/brands/<id>.css`, verbatim                                                       |
| `src/styles/artifact.css`                 | New: the page frame, font stacks, Kobra `:root` tokens bridged into brand scope, and the follow-T3 mapping |

Not included: `tw-animate-css`, `shadcn/tailwind.css` and the No Fun font files. Artifacts use system font stacks, with Geist first when it is installed.
