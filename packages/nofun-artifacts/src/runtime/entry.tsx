// The prebuilt artifact runtime: React, the No Fun components and the two mount paths, exposed on
// `window.__NF` so a custom artifact's compiled entry can share this one React instance.
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

import * as lib from "./index.ts";
import { SpecNode } from "./render-spec.tsx";
import type { ArtifactNode } from "../catalog.ts";

type BoundaryState = { error: Error | null };

class ArtifactBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
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
        <lib.Empty className="border border-border">
          <lib.EmptyHeader>
            <lib.EmptyTitle>This artifact failed to render</lib.EmptyTitle>
            <lib.EmptyDescription>{this.state.error.message}</lib.EmptyDescription>
          </lib.EmptyHeader>
        </lib.Empty>
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

function mountSpec() {
  const source = document.getElementById("nf-spec")?.textContent ?? "null";
  const spec = JSON.parse(source) as { root: ArtifactNode };
  root().render(
    <ArtifactBoundary>
      <SpecNode node={spec.root} />
    </ArtifactBoundary>,
  );
}

function mountApp(App: React.ComponentType) {
  if (typeof App !== "function") {
    console.error("Custom artifact must `export default` a React component.");
    return;
  }
  root().render(
    <ArtifactBoundary>
      <App />
    </ArtifactBoundary>,
  );
}

Object.assign(window, { __NF: { React, jsxRuntime, lib, mountSpec, mountApp } });
