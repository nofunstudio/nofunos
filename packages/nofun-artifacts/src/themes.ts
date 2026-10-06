// Artifact themes are the live No Fun design systems: any brand with a compiled sheet in
// nofun-components (registry/nofun-ui/themes/brands/<id>.css). The page scopes it with data-brand on
// <body>, so it never touches T3's own styles. `t3` pins no brand and follows the reader's T3 theme.
import { brandIds } from "./live/registry.ts";
import { componentsDir } from "./live/source.ts";

export const T3_THEME = "t3";
export const DEFAULT_ARTIFACT_THEME = "kobra";

/** Brand ids from the live checkout (read on each call, so new brands appear without a restart). */
export function artifactThemeIds(): string[] {
  return [...brandIds(componentsDir()), T3_THEME];
}

export function isArtifactTheme(value: unknown): value is string {
  return (
    typeof value === "string" && (value === T3_THEME || brandIds(componentsDir()).includes(value))
  );
}

export function artifactThemeGuide(): string {
  const brands = brandIds(componentsDir());
  return [
    `Any No Fun brand id: ${brands.join(", ") || "(nofun-components checkout not found)"}.`,
    "kobra is No Fun's quiet stock system (white and near-black grounds, gray hairlines, ink actions) and suits data; mrch is acid-lime, pill controls, mono body.",
    `${T3_THEME} pins no brand and follows the reader's T3 theme.`,
  ].join(" ");
}
