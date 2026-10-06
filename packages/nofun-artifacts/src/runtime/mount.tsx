// Browser entry helpers for the tsx and spec lanes: an error boundary and the two mount paths.
import * as React from "react";
import { createRoot } from "react-dom/client";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@nofun/kobra/empty";

import { SpecNode } from "./render-spec.tsx";
import type { ArtifactNode } from "../catalog.ts";

type BoundaryState = { error: Error | null };

export class ArtifactBoundary extends React.Component<
  { children: React.ReactNode },
  BoundaryState
> {
  override state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  override componentDidCatch(error: Error) {
    console.error(`Artifact render failed: ${error.message}`);
  }
  override render() {
    if (this.state.error) {
      return (
        <Empty className="border border-border">
          <EmptyHeader>
            <EmptyTitle>This artifact failed to render</EmptyTitle>
            <EmptyDescription>{this.state.error.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    return this.props.children;
  }
}

function root() {
  const node = document.getElementById("nf-root");
  if (!node) throw new Error("Missing #nf-root");
  return createRoot(node);
}

export function mountSpec() {
  const source = document.getElementById("nf-spec")?.textContent ?? "null";
  const spec = JSON.parse(source) as { root: ArtifactNode };
  root().render(
    <ArtifactBoundary>
      <SpecNode node={spec.root} />
    </ArtifactBoundary>,
  );
}

export function mountApp(App: React.ComponentType) {
  if (typeof App !== "function" && (typeof App !== "object" || App === null)) {
    console.error("Custom artifact must `export default` a React component.");
    return;
  }
  root().render(
    <ArtifactBoundary>
      <App />
    </ArtifactBoundary>,
  );
}
