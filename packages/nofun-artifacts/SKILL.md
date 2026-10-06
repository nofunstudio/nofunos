---
name: nofun-artifacts
description: Build No Fun artifacts in T3 with nofun_artifact_preview and nofun_artifact_render. They are dashboards, charts, tables, comparisons, timelines and galleries made from the real No Fun components in a No Fun theme. Use when a visual says more than prose and real data is in hand.
---

# No Fun artifacts in T3

A local task overlay, adapted from the plan template to the compiled catalog. It is not registered as a global skill yet.

## When to use one

Text stays primary. Build an artifact only when space, interaction or graphics make the answer clearer: several metrics over time, a sortable table, options side by side, a sequence of events, a set of images. Don't build a dashboard just because the tools exist.

Use real data only, from tools, files or the user. Never invent metrics, progress percentages, testimonials or verification badges. If you are showing example data, label it as example data in the artifact.

## Pick a lane

- **spec** (preferred): a JSON object `{"root": node}`, where `node = {"component", "props", "children"?}`. There are 10 components: Stack, Grid, Text, Metric, Status, DataTable, Chart, Gallery, Comparison and Timeline. The tool description lists every prop, and `CATALOG.md` says which No Fun source each one comes from. Only Stack and Grid take children.
- **tsx**: use custom React when the catalog would force a worse result, such as a custom layout or interaction. It must `export default` a component. It compiles against the live No Fun library: import any block as `@nofun/ui/<registry-name>` (find it with `nofun_components_search`; `@nofun/ui/<name>/demo` is a working example), Kobra primitives as `@nofun/kobra/<name>`, the ten components and common primitives from `@nofun/artifacts`, plus `react`, `@tabler/icons-react`, `motion/react` and `recharts`. Style with Tailwind classes on the theme tokens, such as `bg-card`, `text-muted-foreground`, `border-border`, `bg-canvas`, `text-ink`, `micro` and `display-m`. You can't import anything else, fetch anything, or use Node APIs.

Example specs are in `examples/dashboard.spec.json` and `examples/comparison.tsx`.

## Themes

- `kobra`: No Fun's stock neutral look. This is the default.
- `mrch`: lime accent, rounder corners, pill controls, mono body type and uppercase display.
- Any other No Fun brand id (hoopla, mesa-form, smudge-club, ...) themes the page with that brand's design system.
- `t3`: follows the reader's T3 theme live.

The theme only styles the page. It never changes the account, thread or permissions. Light and dark follow the reader's mode in every theme.

## Preview, fix, publish

1. Call `nofun_artifact_preview` at the default width, and again at `width: 390`. Check both `appearance` values if colors matter.
2. Before publishing, fix console errors, empty or clipped content, unreadable labels, broken controls and weak composition. A preview that compiles has not been reviewed: look at the screenshot.
3. Call `nofun_artifact_render` with a short `title` before your final text reply. The artifact shows above the reply, so don't announce it or restate it.

When a call fails, the error names each unknown component, prop or import and its path. Fix the input and call again; don't lower your standards to get past the error. If custom TSX won't compile, fall back to a spec or to plain text rather than leaving the reader with nothing.

## Limits

Each page is one self-contained HTML document. Most are about 360 KiB, because React and the components are inlined. The compiler refuses pages over 2 MiB. Absolute local image paths are inlined, as in `html_render`. Artifacts belong to their thread. Pinning and history are a separate service.
