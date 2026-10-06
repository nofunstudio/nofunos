// Code-enforced page rules, applied after a page is chosen (by Claude or by Jev). Whoever chooses sections cannot
// hold a rule; this does. Ported from nofun-components scripts/jsonrender/enforce.mjs.
//   1. Nav first (an announcement bar may precede it), exactly one SiteNav, added when missing.
//   2. Footer last, exactly one SiteFooter, added when missing.
//   3. Minimum three content sections (everything except announcement, nav, footer), padded from the brand-filtered pool.
//   4. At most one buying section; a FeaturedDrop is pinned to productIndex 3 so it never repeats a hero's products.
//   5. At most one loud divider; at most nine content sections.
import { PAD_ORDER, SLOT_OF_BLOCK_TYPE, SLOT_OF_ID, type Candidate } from "./candidates.ts";
import { BUY, HERO, LOUD_DIVIDERS, NOT_CONTENT, type FlatElement, type FlatSpec } from "./spec.ts";

export interface EnforceReport {
  addedNav: boolean;
  addedFooter: boolean;
  padded: string[];
  droppedDuplicateBuy: number;
  droppedLoud: number;
  trimmed: number;
  /** Extra heroes, navs and footers dropped to keep one of each. */
  droppedDuplicateFrame: number;
}

const TRIM_FIRST = [
  "ProofStats",
  "Faq",
  "AboutTeaser",
  "NewsletterBand",
  "MarqueeStrip",
  "PressQuotes",
];

export function enforce(
  specIn: FlatSpec,
  kept: ReadonlyArray<Candidate>,
  opts: { minContent?: number; maxContent?: number } = {},
) {
  const { minContent = 3, maxContent = 9 } = opts;
  const spec: FlatSpec = structuredClone(specIn);
  const report: EnforceReport = {
    addedNav: false,
    addedFooter: false,
    padded: [],
    droppedDuplicateBuy: 0,
    droppedLoud: 0,
    trimmed: 0,
    droppedDuplicateFrame: 0,
  };
  const root = spec.elements[spec.root]!;
  let kids = [...root.children];
  const typeOf = (k: string) => spec.elements[k]!.type;
  let n = Object.keys(spec.elements).length;
  const mk = (type: string, props: Record<string, unknown>) => {
    const k = `pad-${++n}`;
    spec.elements[k] = { type, props: structuredClone(props), children: [] } satisfies FlatElement;
    return k;
  };
  const mkCand = (cand: Candidate) => mk(cand.element.type, cand.element.props);
  const byId = Object.fromEntries(kept.map((c) => [c.id, c]));

  // 4. one buying section
  const buys = kids.filter((k) => BUY.has(typeOf(k)));
  if (buys.length > 1) {
    const keep = buys.find((k) => typeOf(k) === "FeaturedDrop") ?? buys[0]!;
    kids = kids.filter((k) => !BUY.has(typeOf(k)) || k === keep);
    report.droppedDuplicateBuy = buys.length - 1;
  }
  for (const k of kids) if (typeOf(k) === "FeaturedDrop") spec.elements[k]!.props.productIndex = 3;

  // one hero
  const heroes = kids.filter((k) => HERO.has(typeOf(k)));
  if (heroes.length > 1) {
    kids = kids.filter((k) => !HERO.has(typeOf(k)) || k === heroes[0]);
    report.droppedDuplicateFrame += heroes.length - 1;
  }

  // 5. at most one loud divider; at most maxContent content sections
  const loud = kids.filter((k) => LOUD_DIVIDERS.has(typeOf(k)));
  if (loud.length > 1) {
    kids = kids.filter((k) => !LOUD_DIVIDERS.has(typeOf(k)) || k === loud[0]);
    report.droppedLoud = loud.length - 1;
  }
  const content = () => kids.filter((k) => !NOT_CONTENT.has(typeOf(k)));
  for (const t of TRIM_FIRST) {
    if (content().length <= maxContent) break;
    const k = kids.find((x) => typeOf(x) === t);
    if (k) {
      kids = kids.filter((x) => x !== k);
      report.trimmed++;
    }
  }

  // 3. pad to the minimum, one per slot, from the brand-filtered pool
  const slotsUsed = () => new Set(kids.map((k) => SLOT_OF_BLOCK_TYPE[typeOf(k)]));
  for (const id of PAD_ORDER) {
    if (content().length >= minContent) break;
    const cand = byId[id];
    if (!cand || slotsUsed().has(SLOT_OF_ID[id])) continue;
    kids.push(mkCand(cand));
    report.padded.push(id);
  }

  // 1 + 2. one nav first, one footer last
  const navs = kids.filter((k) => typeOf(k) === "SiteNav");
  let nav = navs[0];
  if (!nav) {
    const c = byId["nav-minimal"];
    nav = c ? mkCand(c) : mk("SiteNav", { variant: "minimal", cartCount: 1 });
    report.addedNav = true;
  }
  report.droppedDuplicateFrame += Math.max(0, navs.length - 1);
  const footers = kids.filter((k) => typeOf(k) === "SiteFooter");
  let footer = footers[footers.length - 1];
  if (!footer) {
    const c = byId["footer-columns"];
    footer = c ? mkCand(c) : mk("SiteFooter", { variant: "columns" });
    report.addedFooter = true;
  }
  report.droppedDuplicateFrame += Math.max(0, footers.length - 1);
  const ann = kids.find((k) => typeOf(k) === "AnnouncementBar");
  const rest = kids.filter(
    (k) => !["SiteNav", "SiteFooter", "AnnouncementBar"].includes(typeOf(k)),
  );
  const hero = rest.find((k) => HERO.has(typeOf(k)));
  const body = hero ? [hero, ...rest.filter((k) => k !== hero)] : rest;
  root.children = [ann, nav, ...body, footer].filter((k): k is string => k !== undefined);
  return { spec, report };
}
