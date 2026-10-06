// Candidate blocks for one brand: every element recipe a page can be built from, grouped by page SLOT
// (hero, buy, story, voice, divider, closer). Ported from nofun-components scripts/jsonrender/candidates.mjs.
import type { ResolvedBrand } from "./brands.ts";

export const SLOTS = [
  "announcement",
  "nav",
  "hero",
  "buy",
  "story",
  "voice",
  "divider",
  "closer",
  "footer",
] as const;
export type Slot = (typeof SLOTS)[number];

export interface Candidate {
  readonly id: string;
  readonly description: string;
  readonly element: { readonly type: string; readonly props: Record<string, unknown> };
  readonly root: boolean;
  /** Candidates sharing a resource are mutually exclusive (json-render composeSpec). */
  readonly resource?: Slot;
}

export function candidatesFor(brand: ResolvedBrand): Candidate[] {
  const c = brand.copy,
    B = brand.facts;
  const out: Candidate[] = [
    {
      id: "page",
      description: "The page frame that holds every section from top to bottom",
      element: { type: "Page", props: {} },
      root: true,
    },
  ];
  const add = (
    resource: Slot,
    id: string,
    description: string,
    type: string,
    props: Record<string, unknown>,
  ) => out.push({ id, description, element: { type, props }, root: false, resource });
  const copy = (i: number) => ({
    eyebrow: c.eyebrow[i % 3]!,
    headline: c.headline[i % 3]!,
    sub: c.sub[i % 2]!,
    cta: c.cta[i % 3]!,
  });
  const img = (kind: "lifestyle" | "wide") =>
    kind === "lifestyle"
      ? B.photo
        ? `uses the brand's own photo (${B.note})`
        : "no brand photo exists, so it would show a product mockup"
      : `uses a wide image; ${B.photo ? B.note : "a product mockup"}`;

  add("announcement", "ann-static", `Thin announcement strip: "${c.band[0]}"`, "AnnouncementBar", {
    variant: "static",
    messages: c.band.slice(0, 2),
  });
  add("announcement", "ann-marquee", "Scrolling announcement strip", "AnnouncementBar", {
    variant: "marquee",
    messages: c.band.slice(0, 3),
  });
  for (const v of ["minimal", "centered", "sticky"])
    add("nav", `nav-${v}`, `Top navigation, ${v} style, with logo, links and cart`, "SiteNav", {
      variant: v,
      cartCount: 1,
    });

  const H = (id: string, text: string, type: string, props: Record<string, unknown>) =>
    add("hero", id, text, type, props);
  H(
    "hero-fb-bottom",
    `Full-bleed photo hero, headline at the bottom. "${copy(0).headline}". Image: ${img("lifestyle")}`,
    "HeroFullBleed",
    { variant: "bottom-start", image: "lifestyle", ...copy(0) },
  );
  H(
    "hero-fb-center",
    `Full-bleed photo hero, centered headline. "${copy(1).headline}". Image: ${img("lifestyle")}`,
    "HeroFullBleed",
    { variant: "center", image: "lifestyle", ...copy(1) },
  );
  H(
    "hero-fb-poster",
    `Full-bleed poster hero with a big title. "${copy(2).headline}". Image: ${img("lifestyle")}`,
    "HeroFullBleed",
    { variant: "poster", image: "lifestyle", ...copy(2) },
  );
  H(
    "hero-fb-ticker",
    `Full-bleed photo hero with a scrolling ticker. Image: ${img("lifestyle")}`,
    "HeroFullBleed",
    { variant: "with-ticker", image: "lifestyle", ...copy(0) },
  );
  H("hero-fb-wide", `Full-bleed wide-image hero. Image: ${img("wide")}`, "HeroFullBleed", {
    variant: "bottom-start",
    image: "wide",
    ...copy(1),
  });
  H(
    "hero-split",
    `Half text, half product image hero, image on the start side. "${copy(1).headline}"`,
    "HeroSplit",
    { variant: "image-start", ...copy(1) },
  );
  H(
    "hero-split-tilt",
    `Hero with tilted product cards beside the headline. Playful and loud. "${copy(0).headline}"`,
    "HeroSplit",
    { variant: "tilted", ...copy(0) },
  );
  H(
    "hero-type-center",
    `Type-only centered hero, no image. Calm and safe on any brand. "${copy(2).headline}"`,
    "HeroTypeStack",
    { variant: "centered", ...copy(2) },
  );
  H(
    "hero-type-start",
    `Type-only hero, start aligned, no image. "${copy(1).headline}"`,
    "HeroTypeStack",
    { variant: "start", ...copy(1) },
  );
  H(
    "hero-type-products",
    `Type hero with a row of three products under the headline (also a buying moment). "${copy(0).headline}"`,
    "HeroTypeStack",
    { variant: "with-product-row", ...copy(0) },
  );
  H(
    "hero-stacked",
    `One product mockup layered over a headline. "${copy(0).headline}"`,
    "HeroStackedProduct",
    { variant: "stacked", ...copy(0) },
  );
  H(
    "hero-marquee",
    `Huge scrolling headline line with product tiles; loud. "${copy(1).headline}"`,
    "HeroMarquee",
    { variant: "single-line", ...copy(1) },
  );
  H(
    "hero-editorial-grid",
    `Editorial hero: large headline and a grid of three products. "${copy(2).headline}"`,
    "HeroEditorialGrid",
    copy(2),
  );
  H(
    "hero-diptych",
    `Two photos side by side with a serif title across the seam; fashion register. Image: ${img("lifestyle")}`,
    "CampaignDiptych",
    {
      eyebrow: c.eyebrow[0],
      title: c.headline[0],
      accentWord: "this season",
      sub: c.sub[0],
      cta: c.cta[0],
    },
  );
  const posterLines = c.headline[1]!.split(" ")
    .reduce<string[]>((a, w) => {
      const l = a[a.length - 1];
      if (l !== undefined && `${l} ${w}`.length <= 11) a[a.length - 1] = `${l} ${w}`;
      else a.push(w);
      return a;
    }, [])
    .concat(["now"])
    .slice(0, 4);
  H(
    "hero-poster-type",
    `Giant poster type, text only, no image. "${c.headline[1]}"`,
    "PosterHeadline",
    { lines: posterLines, aside: c.sub[0]!.split(".")[0], cta: c.cta[0] },
  );

  add(
    "buy",
    "grid-4",
    "Product grid, 4 across, 8 items, with filter chips. The main buying moment.",
    "ProductGrid",
    { variant: "uniform", density: 4, count: 8, filters: true },
  );
  add(
    "buy",
    "grid-masonry",
    "Masonry product grid of 8 items, no filters. A buying moment.",
    "ProductGrid",
    { variant: "masonry", density: 4, count: 8, filters: false },
  );
  add(
    "buy",
    "bento",
    "Bento grid of products on light and dark tiles. A buying moment.",
    "ProductBento",
    { variant: "2x3" },
  );
  add("buy", "rail", "Horizontal product rail titled New in. A buying moment.", "CollectionRail", {
    variant: "cards",
    title: "New in",
    blurb: "Picked by hand",
    count: 8,
  });
  add("buy", "ticker", "Looping strip of product cards. A buying moment.", "ProductTicker", {
    count: 8,
    speed: 56,
  });
  add("buy", "lookbook", "Photo wall made from the product images.", "LookbookGrid", {
    variant: "masonry",
    count: 8,
  });
  add(
    "buy",
    "featured",
    "One featured product with size and color pickers and an add button. The single focused buying moment.",
    "FeaturedDrop",
    { variant: "image-start", eyebrow: c.eyebrow[0], productIndex: 3 },
  );
  add("buy", "tiles", "Shop-by-collection tiles, 4 collections.", "CollectionTiles", {
    variant: "grid",
    count: 4,
  });

  add(
    "story",
    "manifesto",
    `Short house rules list: "${c.manifesto[0]}" "${c.manifesto[1]}" ...`,
    "Manifesto",
    { variant: "list", heading: "How we work", lines: c.manifesto.slice(0, 5) },
  );
  add("story", "about", "About teaser with a statement paragraph", "AboutTeaser", {
    variant: "statement",
    heading: c.about[0],
    body: c.about[1],
  });
  add("voice", "press", `Large pull quotes: "${c.press[0]}"`, "PressQuotes", {
    heading: "In our words",
    quotes: c.press,
  });
  add("voice", "proof", "Small counts taken from the catalog (designs, colors)", "ProofStats", {});
  add("voice", "faq", `FAQ section "${c.faq}"`, "Faq", {
    variant: "single-column",
    heading: c.faq,
  });

  add(
    "divider",
    "div-marquee",
    "Scrolling tape of short phrases between sections",
    "MarqueeStrip",
    { tone: "ink", size: "display-m", direction: "forward", items: c.band },
  );
  add(
    "divider",
    "div-torn",
    `Torn-paper band with the line "${c.tear[0]}". Loud divider.`,
    "TornBand",
    { tone: 3, tape: "center", edges: "both", seed: 7, text: c.tear[0] },
  );
  add(
    "divider",
    "div-rating",
    `Warning-label style scrolling band: "${c.rating[1]}". Loud divider.`,
    "RatingBand",
    { mark: c.rating[0], title: c.rating[1], note: c.rating[2], tone: 2, direction: "forward" },
  );
  add(
    "divider",
    "div-outline",
    `Giant draggable outline wordmark "${c.tear[1]}". Very loud, use at most once.`,
    "StackedOutlineText",
    { text: c.tear[1], stacks: 8 },
  );

  add("closer", "cta", `Closing call to action band "${c.cta2[0]}"`, "CtaBand", {
    variant: "inverted",
    heading: c.cta2[0],
    sentence: c.cta2[1],
    cta: c.cta[0],
  });
  add("closer", "newsletter", `Email signup band "${c.newsletter[0]}"`, "NewsletterBand", {
    variant: "inline",
    heading: c.newsletter[0],
    sub: c.newsletter[1],
  });
  for (const v of ["columns", "compact"])
    add("footer", `footer-${v}`, `Footer, ${v} layout, with logo and links`, "SiteFooter", {
      variant: v,
    });
  return out;
}

/** Slot order and fallback pool used by the code-enforced minimum (first fit wins, brand-filtered). */
export const PAD_ORDER = [
  "featured",
  "grid-4",
  "manifesto",
  "about",
  "press",
  "div-marquee",
  "cta",
] as const;

export const SLOT_OF_BLOCK_TYPE: Record<string, Slot> = {
  FeaturedDrop: "buy",
  ProductGrid: "buy",
  ProductBento: "buy",
  CollectionRail: "buy",
  ProductTicker: "buy",
  LookbookGrid: "buy",
  CollectionTiles: "buy",
  Manifesto: "story",
  AboutTeaser: "story",
  PressQuotes: "voice",
  ProofStats: "voice",
  Faq: "voice",
  MarqueeStrip: "divider",
  TornBand: "divider",
  RatingBand: "divider",
  StackedOutlineText: "divider",
  CtaBand: "closer",
  NewsletterBand: "closer",
};

export const SLOT_OF_ID: Record<string, Slot> = {
  "grid-4": "buy",
  "grid-masonry": "buy",
  bento: "buy",
  rail: "buy",
  ticker: "buy",
  lookbook: "buy",
  featured: "buy",
  tiles: "buy",
  manifesto: "story",
  about: "story",
  press: "voice",
  proof: "voice",
  faq: "voice",
  "div-marquee": "divider",
  "div-torn": "divider",
  "div-rating": "divider",
  "div-outline": "divider",
  cta: "closer",
  newsletter: "closer",
};
