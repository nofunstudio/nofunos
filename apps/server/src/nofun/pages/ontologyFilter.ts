// Ontology pre-filter: drop catalog blocks that cannot suit a brand before anything composes with them.
// Ported from nofun-components scripts/jsonrender/ontology-filter.mjs. The original reads public/r/ontology.json
// for authored block styles; 28 of 31 blocks only carry derived tags there, so the decisions all came from the
// override table below. This port keeps only that table (blocks without a row are always allowed).
import type { Candidate } from "./candidates.ts";
import type { BrandProfile } from "./brands.ts";

interface StyleOverride {
  readonly energy: ReadonlyArray<string>;
  readonly surface: ReadonlyArray<string>;
  readonly needsPhoto?: boolean;
  readonly degenerate?: string;
}

const STYLE_OVERRIDE: Record<string, StyleOverride> = {
  StackedOutlineText: {
    energy: ["loud", "brutal"],
    surface: ["outline"],
    degenerate: "renders as an empty outlined box in the preview sheets",
  },
  RatingBand: { energy: ["loud", "playful"], surface: ["flat", "outline"] },
  TornBand: { energy: ["loud", "playful"], surface: ["paper"] },
  HeroMarquee: { energy: ["loud"], surface: ["outline"] },
  PosterHeadline: { energy: ["loud"], surface: ["flat"] },
  HeroSplit: { energy: ["calm"], surface: ["flat"] },
  "HeroSplit:tilted": { energy: ["playful", "loud"], surface: ["flat"] },
  CampaignDiptych: { energy: ["luxe", "calm"], surface: ["photo"], needsPhoto: true },
  HeroFullBleed: { energy: ["calm", "loud"], surface: ["photo"] },
  HeroLookbook: { energy: ["calm", "luxe"], surface: ["photo"], needsPhoto: true },
  LookbookGrid: { energy: ["calm"], surface: ["photo"], needsPhoto: false },
  HeroEditorialGrid: { energy: ["calm", "luxe"], surface: ["photo", "flat"] },
};

const LOUD = new Set(["loud", "brutal", "playful"]);
const QUIET = new Set(["calm", "luxe", "soft", "deadpan"]);

export interface Verdict {
  readonly ok: boolean;
  readonly rule?: "degenerate" | "energy" | "surface";
  readonly why?: string;
}

export function verdict(
  type: string,
  props: Record<string, unknown> | undefined,
  profile: BrandProfile,
): Verdict {
  const variant = typeof props?.variant === "string" ? props.variant : undefined;
  const s = STYLE_OVERRIDE[`${type}:${variant}`] ?? STYLE_OVERRIDE[type];
  if (s === undefined) return { ok: true };
  if (s.degenerate) return { ok: false, rule: "degenerate", why: s.degenerate };
  const e = s.energy;
  const blockLoud = e.some((t) => LOUD.has(t)) && !e.some((t) => QUIET.has(t));
  const brandLoud = profile.energy.some((t) => LOUD.has(t));
  if (blockLoud && !brandLoud)
    return {
      ok: false,
      rule: "energy",
      why: `block energy [${e}] is loud-only, brand energy [${profile.energy}] is calm`,
    };
  if (e.length > 0 && e.every((t) => t === "luxe") && profile.energy.includes("brutal"))
    return { ok: false, rule: "energy", why: "block is luxe-only, brand is brutal" };
  if (s.needsPhoto && !profile.photo)
    return {
      ok: false,
      rule: "surface",
      why: `block surface [${s.surface}] needs photography, brand has none`,
    };
  if (type === "HeroFullBleed" && props?.image !== "product" && !profile.fullBleedOk)
    return {
      ok: false,
      rule: "surface",
      why: "brand has no photo wide enough for a full-bleed hero (clipped or mockup stand-in)",
    };
  if (s.surface.includes("paper") && profile.surface.includes("glass"))
    return { ok: false, rule: "surface", why: "paper-torn surface on a glass brand" };
  return { ok: true };
}

export interface Rejection extends Verdict {
  readonly id: string;
  readonly type: string;
}

export function filterCandidates(cands: ReadonlyArray<Candidate>, profile: BrandProfile) {
  const kept: Candidate[] = [];
  const rejected: Rejection[] = [];
  for (const c of cands) {
    const v = verdict(c.element.type, c.element.props, profile);
    if (v.ok) kept.push(c);
    else rejected.push({ id: c.id, type: c.element.type, ...v });
  }
  return { kept, rejected };
}

/** Energy and surface tags for a block, as the judge is shown them. */
export function blockTags(type: string, variant: string | undefined) {
  const s = STYLE_OVERRIDE[`${type}:${variant}`] ?? STYLE_OVERRIDE[type];
  return { energy: s?.energy ?? [], surface: s?.surface ?? [] };
}
