// The flat json-render spec shape ({root, elements}) the page tools build and enforce.
import type { Candidate } from "./candidates.ts";

export interface FlatElement {
  type: string;
  props: Record<string, unknown>;
  children: string[];
}

export interface FlatSpec {
  root: string;
  elements: Record<string, FlatElement>;
  meta?: Record<string, unknown>;
}

export const NOT_CONTENT = new Set(["AnnouncementBar", "SiteNav", "SiteFooter"]);
export const BUY = new Set([
  "ProductGrid",
  "ProductBento",
  "CollectionRail",
  "ProductTicker",
  "LookbookGrid",
  "FeaturedDrop",
  "CollectionTiles",
]);
export const HERO = new Set([
  "HeroFullBleed",
  "HeroSplit",
  "HeroTypeStack",
  "HeroStackedProduct",
  "HeroMarquee",
  "HeroEditorialGrid",
  "CampaignDiptych",
  "HeroLookbook",
  "PosterHeadline",
]);
export const LOUD_DIVIDERS = new Set(["StackedOutlineText", "TornBand", "RatingBand"]);

/** Throws a readable message when the value is not a flat spec whose root lists existing child elements. */
export function parseFlatSpec(value: unknown): FlatSpec {
  const fail = (why: string): never => {
    throw new Error(
      `Invalid page spec: ${why}. Expected {"root": "page", "elements": {"page": {"type": "Page", "props": {}, "children": ["nav", ...]}, ...}}.`,
    );
  };
  if (typeof value !== "object" || value === null) return fail("not an object");
  const raw = value as { root?: unknown; elements?: unknown; meta?: unknown };
  if (typeof raw.root !== "string") return fail("root must be an element id string");
  if (typeof raw.elements !== "object" || raw.elements === null)
    return fail("elements must be an object");
  const elements: Record<string, FlatElement> = {};
  for (const [id, el] of Object.entries(raw.elements as Record<string, unknown>)) {
    const e = el as { type?: unknown; props?: unknown; children?: unknown };
    if (typeof e?.type !== "string") return fail(`element "${id}" has no type`);
    const children = Array.isArray(e.children) ? e.children.map(String) : [];
    elements[id] = {
      type: e.type,
      props: (typeof e.props === "object" && e.props !== null ? e.props : {}) as Record<
        string,
        unknown
      >,
      children,
    };
  }
  const root = elements[raw.root];
  if (!root) return fail(`root "${raw.root}" is not in elements`);
  if (root.type !== "Page") return fail(`root element must have type "Page"`);
  for (const k of root.children) if (!elements[k]) return fail(`root lists unknown child "${k}"`);
  return {
    root: raw.root,
    elements,
    ...(raw.meta && typeof raw.meta === "object"
      ? { meta: raw.meta as Record<string, unknown> }
      : {}),
  };
}

/** A Page spec from ordered candidates (each used once; ids are suffixed so they stay unique). */
export function specFromCandidates(ordered: ReadonlyArray<Candidate>): FlatSpec {
  const elements: Record<string, FlatElement> = { page: { type: "Page", props: {}, children: [] } };
  ordered.forEach((c, i) => {
    const key = `${c.id}-${i + 1}`;
    elements[key] = {
      type: c.element.type,
      props: structuredClone(c.element.props) as Record<string, unknown>,
      children: [],
    };
    elements.page!.children.push(key);
  });
  return { root: "page", elements };
}

export const childrenOf = (spec: FlatSpec) =>
  spec.elements[spec.root]!.children.map((k) => spec.elements[k]!);

export const summarize = (spec: FlatSpec) =>
  childrenOf(spec).map(
    (e) => e.type + (typeof e.props.variant === "string" ? `:${e.props.variant}` : ""),
  );
