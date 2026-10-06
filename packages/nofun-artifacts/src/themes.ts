// Artifact themes. Each pinned theme is a real No Fun design system compiled by nofun-components
// (registry/nofun-ui/themes/brands/<id>.css, snapshotted under src/styles/themes). The artifact page
// scopes it with data-brand on <html>, so it never touches T3's own styles. `t3` pins nothing and
// follows the reader's T3 theme live through the variables T3 injects into every HTML render.

export const ARTIFACT_THEMES = {
  kobra: {
    label: "No Fun (Kobra)",
    description:
      "No Fun's stock system: white and near-black grounds, gray hairlines, ink primary actions, gray chart ramp. Quiet; content reads first.",
    file: "kobra.css",
  },
  mrch: {
    label: "MRCH",
    description:
      "MRCH brand: acid-lime accent, lime-tinted grounds and chart ramp, 28px card radius, pill controls, mono body type, uppercase bold display.",
    file: "mrch.css",
  },
  t3: {
    label: "Follow T3",
    description: "No brand: follows the reader's current T3 theme, accent and fonts, live.",
    file: null,
  },
} as const;

export type ArtifactThemeId = keyof typeof ARTIFACT_THEMES;

export const ARTIFACT_THEME_IDS = Object.keys(ARTIFACT_THEMES) as ArtifactThemeId[];

export const DEFAULT_ARTIFACT_THEME: ArtifactThemeId = "kobra";

export function isArtifactThemeId(value: unknown): value is ArtifactThemeId {
  return typeof value === "string" && Object.hasOwn(ARTIFACT_THEMES, value);
}

export function artifactThemeGuide(): string {
  return ARTIFACT_THEME_IDS.map((id) => `${id}: ${ARTIFACT_THEMES[id].description}`).join(" ");
}
