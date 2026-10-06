// Browser entry for the page lane: a json-render page spec rendered by nofun-components' own
// experiments/json-render catalog and registry (real landing blocks + BrandProvider imagery), inside
// a brand scope the way app/experiments/json-render/page.tsx renders it.
import { createRoot } from "react-dom/client";

import { SpecView } from "@nofun/source/experiments/json-render/spec-view";
import { SchemeScope } from "@nofun/source/registry/nofun-ui/blocks/_shared/scheme-scope";
import { PortalScope } from "@nofun/source/registry/nofun-ui/blocks/pdp/_shared/portal-scope";

import { ArtifactBoundary } from "./mount.tsx";

type Scheme = "light" | "dark";
type PageData = { spec: never; brand: string; scheme: Scheme; schemes: Scheme[] };

export function mountPage() {
  const data = JSON.parse(document.getElementById("nf-page")?.textContent ?? "null") as PageData;
  const node = document.getElementById("nf-root");
  if (!node || !data) throw new Error("Missing page data");
  const dark = data.scheme === "dark";
  createRoot(node).render(
    <div
      data-brand={data.brand}
      data-nf-scheme={data.schemes.length === 1 ? data.schemes[0] : undefined}
      data-theme={dark ? "dark" : undefined}
      className={`${dark ? "dark " : ""}min-h-screen bg-canvas text-ink`}
    >
      <SchemeScope scheme={data.scheme} schemes={data.schemes} />
      <PortalScope />
      <ArtifactBoundary>
        <SpecView spec={data.spec} brand={data.brand} />
      </ArtifactBoundary>
    </div>,
  );
}
