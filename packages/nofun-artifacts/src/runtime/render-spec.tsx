// Renders a validated catalog spec. The server already checked component names and props against
// catalog.ts; this only maps names to components and recurses into children.
import * as React from "react";

import * as lib from "./index.ts";
import type { ArtifactNode } from "../catalog.ts";

const COMPONENTS: Record<string, React.ComponentType<Record<string, unknown>>> = {
  Stack: lib.Stack as never,
  Grid: lib.Grid as never,
  Text: lib.Text as never,
  Metric: lib.Metric as never,
  Status: lib.Status as never,
  DataTable: lib.DataTable as never,
  Chart: lib.Chart as never,
  Gallery: lib.Gallery as never,
  Comparison: lib.Comparison as never,
  Timeline: lib.Timeline as never,
};

export function SpecNode({ node }: { node: ArtifactNode }): React.ReactElement | null {
  const Component = COMPONENTS[node.component];
  if (!Component) return null;
  const children = node.children?.map((child, index) => (
    <SpecNode key={child.key ?? index} node={child} />
  ));
  return <Component {...(node.props ?? {})}>{children}</Component>;
}
