// Claude-authored page composition: resolve an explicit section list (candidate ids or slot names) against the
// brand-filtered candidates, then enforce the page rules. No model call happens here.
import { candidatesFor, SLOTS, type Candidate, type Slot } from "./candidates.ts";
import { resolveBrand, type ResolvedBrand } from "./brands.ts";
import { enforce, type EnforceReport } from "./enforce.ts";
import { filterCandidates, verdict, type Rejection } from "./ontologyFilter.ts";
import {
  BUY,
  HERO,
  LOUD_DIVIDERS,
  NOT_CONTENT,
  childrenOf,
  specFromCandidates,
  summarize,
  type FlatSpec,
} from "./spec.ts";

export interface BrandPool {
  readonly brand: ResolvedBrand;
  readonly all: Candidate[];
  readonly kept: Candidate[];
  readonly rejected: Rejection[];
}

export function poolFor(brandName: string): BrandPool {
  const brand = resolveBrand(brandName);
  const all = candidatesFor(brand);
  const { kept, rejected } = filterCandidates(all, brand.profile);
  return { brand, all, kept, rejected };
}

export interface ResolvedSections {
  readonly candidates: Candidate[];
  /** What happened to each requested entry, for the tool result. */
  readonly notes: string[];
}

const isSlot = (s: string): s is Slot => (SLOTS as ReadonlyArray<string>).includes(s);

/**
 * Entries are candidate ids ("hero-type-center") or slot names ("hero", "buy": the first surviving candidate in
 * that slot). An entry the brand filter removed is skipped with the reason; an unknown entry is an error.
 */
export function resolveSections(pool: BrandPool, entries: ReadonlyArray<string>): ResolvedSections {
  const candidates: Candidate[] = [];
  const notes: string[] = [];
  const byId = new Map(pool.all.map((c) => [c.id, c]));
  const keptIds = new Set(pool.kept.map((c) => c.id));
  const unknown: string[] = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (isSlot(entry)) {
      const first = pool.kept.find((c) => c.resource === entry);
      if (first) {
        candidates.push(first);
        notes.push(`${entry} -> ${first.id}`);
      } else notes.push(`${entry}: no candidate survives the ${pool.brand.id} filter`);
      continue;
    }
    const cand = byId.get(entry);
    if (!cand || cand.root) {
      unknown.push(entry);
      continue;
    }
    if (!keptIds.has(entry)) {
      const why = pool.rejected.find((r) => r.id === entry);
      notes.push(`${entry}: dropped, ${why?.why ?? "filtered for this brand"}`);
      continue;
    }
    candidates.push(cand);
  }
  if (unknown.length > 0) {
    throw new Error(
      `Unknown section${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Use slot names (${SLOTS.join(", ")}) or block ids from nofun_page_catalog.`,
    );
  }
  return { candidates, notes };
}

export interface ComposedPage {
  readonly spec: FlatSpec;
  readonly report: EnforceReport;
  readonly blocks: string[];
  readonly notes: string[];
}

export function composeFromSections(pool: BrandPool, entries: ReadonlyArray<string>): ComposedPage {
  const { candidates, notes } = resolveSections(pool, entries);
  const { spec, report } = enforce(specFromCandidates(candidates), pool.kept);
  return { spec, report, blocks: summarize(spec), notes };
}

/** Enforce a spec Claude wrote itself (full json-render spec): the brand filter first, then the page rules. */
export function composeFromSpec(pool: BrandPool, specIn: FlatSpec): ComposedPage {
  const spec: FlatSpec = structuredClone(specIn);
  const root = spec.elements[spec.root]!;
  const notes: string[] = [];
  root.children = root.children.filter((k) => {
    const e = spec.elements[k]!;
    const v = verdict(e.type, e.props, pool.brand.profile);
    if (!v.ok) notes.push(`${e.type}: dropped, ${v.why}`);
    return v.ok;
  });
  const out = enforce(spec, pool.kept);
  return { spec: out.spec, report: out.report, blocks: summarize(out.spec), notes };
}

/** Brand filter plus page rules for a flat spec; `composeFromSpec` with just the spec and report. */
export const enforcePage = (pool: BrandPool, spec: FlatSpec) => {
  const out = composeFromSpec(pool, spec);
  return { spec: out.spec, report: out.report, notes: out.notes };
};

/** One-line description of what the enforcer changed, or null when it changed nothing. */
export function describeReport(r: EnforceReport): string | null {
  const parts: string[] = [];
  if (r.addedNav) parts.push("added a nav");
  if (r.addedFooter) parts.push("added a footer");
  if (r.padded.length) parts.push(`padded ${r.padded.join(", ")} to reach 3 content sections`);
  if (r.droppedDuplicateBuy) parts.push(`dropped ${r.droppedDuplicateBuy} extra buying section(s)`);
  if (r.droppedLoud) parts.push(`dropped ${r.droppedLoud} extra loud divider(s)`);
  if (r.droppedDuplicateFrame)
    parts.push(`dropped ${r.droppedDuplicateFrame} extra hero/nav/footer`);
  if (r.trimmed) parts.push(`trimmed ${r.trimmed} section(s) over the cap of 9`);
  return parts.length ? parts.join("; ") : null;
}

const PRODUCT_HERO = (e: { type: string; props: Record<string, unknown> }) =>
  e.type === "HeroMarquee" ||
  e.type === "HeroEditorialGrid" ||
  e.type === "HeroStackedProduct" ||
  e.type === "HeroSplit" ||
  (e.type === "HeroTypeStack" && e.props.variant === "with-product-row") ||
  e.type === "HeroLookbook" ||
  (e.type === "HeroFullBleed" && e.props.variant === "with-ticker");

/** Text-level facts about a page, the same ones the judge is shown and the flaws it is measured against. */
export function pageFeatures(spec: FlatSpec, brand: ResolvedBrand) {
  const kids = childrenOf(spec);
  const types = kids.map((e) => e.type);
  const content = kids.filter((e) => !NOT_CONTENT.has(e.type));
  const nav = types.indexOf("SiteNav");
  const hero = kids.find((e) => HERO.has(e.type));
  const buys = kids.filter((e) => BUY.has(e.type));
  const loud = content.filter((e) => LOUD_DIVIDERS.has(e.type));
  return {
    blocks: summarize(spec),
    contentSections: content.length,
    navFirst: nav === 0 || (nav === 1 && types[0] === "AnnouncementBar"),
    footerLast: types[types.length - 1] === "SiteFooter",
    repeatedProducts:
      buys.length >= 2 || (hero !== undefined && PRODUCT_HERO(hero) && buys.length >= 1),
    emptyBlock: types.includes("StackedOutlineText"),
    loudDividers: loud.length,
    photoHeroNoPhoto:
      hero !== undefined &&
      ((hero.type === "HeroFullBleed" && hero.props.image !== "product") ||
        hero.type === "CampaignDiptych") &&
      !brand.facts.photo,
  };
}

export type PageFeatures = ReturnType<typeof pageFeatures>;

export const countFlaws = (f: PageFeatures) =>
  [
    !f.navFirst,
    !f.footerLast,
    f.repeatedProducts,
    f.emptyBlock,
    f.loudDividers > 1,
    f.photoHeroNoPhoto,
    f.contentSections < 3,
  ].filter(Boolean).length;
