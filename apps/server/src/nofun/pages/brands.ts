// Brand facts, style profiles and copy banks the page tools compose from. Ported from nofun-components
// (scripts/jsonrender/common.mjs, ontology-filter.mjs, experiments/json-render/copy.mjs). Unknown brands get a
// conservative generic entry built from the brand name, so the tools never refuse a brand.

export interface BrandFacts {
  readonly about: string;
  /** Whether the brand has photography a full-bleed or diptych hero can use. */
  readonly photo: boolean;
  readonly note: string;
}

export interface BrandProfile {
  readonly energy: ReadonlyArray<string>;
  readonly surface: ReadonlyArray<string>;
  readonly photo: boolean;
  readonly fullBleedOk: boolean;
}

export interface BrandCopy {
  readonly eyebrow: ReadonlyArray<string>;
  readonly headline: ReadonlyArray<string>;
  readonly sub: ReadonlyArray<string>;
  readonly cta: ReadonlyArray<string>;
  readonly manifesto: ReadonlyArray<string>;
  readonly about: readonly [string, ReadonlyArray<string>];
  readonly band: ReadonlyArray<string>;
  readonly newsletter: readonly [string, string];
  readonly cta2: readonly [string, string];
  readonly press: ReadonlyArray<string>;
  readonly rating: readonly [string, string, string];
  readonly faq: string;
  readonly tear: readonly [string, string];
}

export interface ResolvedBrand {
  readonly id: string;
  readonly known: boolean;
  readonly facts: BrandFacts;
  readonly profile: BrandProfile;
  readonly copy: BrandCopy;
}

const FACTS: Record<string, BrandFacts> = {
  hardline: {
    about: "square-cornered, thick-stroke, loud spec-sheet streetwear",
    photo: false,
    note: "no brand photography exists; product mockups only",
  },
  hoopla: {
    about: "loud, friendly bubble-letter streetwear in bright colors",
    photo: true,
    note: "one transparent-cutout portrait, no wide photo",
  },
  "mesa-form": {
    about: "quiet technical outdoor gear with a wide desert photo, 5 products",
    photo: true,
    note: "a wide landscape photo",
  },
  "ace-row": {
    about: "editorial fashion in cream and ink with real editorial photos",
    photo: true,
    note: "portrait editorial photos and a wide band photo",
  },
  "smudge-club": {
    about: "deadpan sportswear with spray paint, a court photo",
    photo: true,
    note: "a wide court photo",
  },
};

const PROFILES: Record<string, BrandProfile> = {
  hardline: {
    energy: ["brutal", "loud"],
    surface: ["flat", "outline", "paper"],
    photo: false,
    fullBleedOk: false,
  },
  hoopla: {
    energy: ["loud", "playful"],
    surface: ["flat", "sticker"],
    photo: true,
    fullBleedOk: false,
  },
  "mesa-form": {
    energy: ["calm", "luxe"],
    surface: ["glass", "photo"],
    photo: true,
    fullBleedOk: true,
  },
  "ace-row": {
    energy: ["luxe", "calm"],
    surface: ["photo", "flat", "sticker"],
    photo: true,
    fullBleedOk: true,
  },
  "smudge-club": {
    energy: ["deadpan", "loud"],
    surface: ["grain", "photo", "flat"],
    photo: true,
    fullBleedOk: true,
  },
};

const COPY: Record<string, BrandCopy> = {
  hardline: {
    eyebrow: ["Spec sheet 01", "Issue 04", "Rule one"],
    headline: ["Square corners only", "Built loud, shipped flat", "Hard lines, soft cotton"],
    sub: [
      "Thick strokes and short rules for people who like a plan.",
      "A kit for things that should look like they mean it.",
    ],
    cta: ["Get the kit", "Shop now", "See specs"],
    manifesto: [
      "Label everything.",
      "Strokes are never thin.",
      "Corners stay square.",
      "Shadows are hard and offset.",
      "If it is clear, ship it.",
    ],
    about: [
      "About the system",
      [
        "Hardline is a set of rules that happen to look good. We write them down so you can break them on purpose.",
      ],
    ],
    band: ["Rules, not vibes", "Hard offset shadows", "Always labeled"],
    newsletter: ["Get the changelog", "One email per release."],
    cta2: ["Start with the sheet", "Everything is documented. Read it, then ignore it."],
    press: ["Say what it is.", "Make it obvious."],
    rating: ["H", "Hardline", "Contains strong outlines"],
    faq: "Read this first",
    tear: ["Rule one", "No soft edges"],
  },
  hoopla: {
    eyebrow: ["New this week", "Bright days", "Say hi"],
    headline: ["Loud and kind", "Sunny side up", "Wear the good mood"],
    sub: [
      "Big bubble letters and softer sweatshirts for everyday joy.",
      "Clothes that wave at you first.",
    ],
    cta: ["Shop the drop", "Come play", "Say hi"],
    manifesto: [
      "Be kind out loud.",
      "Wear the bright one.",
      "Hugs are free.",
      "Dance in the store.",
      "Everybody gets a sticker.",
    ],
    about: [
      "Hello, we are Hoopla",
      [
        "Hoopla makes loud, friendly streetwear in colors you can hear. We keep the sentences short and the sleeves long.",
      ],
    ],
    band: ["Bright days ahead", "Sunny side", "Hoopla hoopla"],
    newsletter: ["Join the hoopla", "Good news on Fridays, never more."],
    cta2: ["Pick your bright", "Free stickers with every order."],
    press: ["Wear the good mood.", "Kindness has a color."],
    rating: ["G", "Great vibes", "Safe for all moods"],
    faq: "Questions, answered nicely",
    tear: ["Say hi", "Bright days"],
  },
  "mesa-form": {
    eyebrow: ["Field issue", "Ridgeline", "Spec 07"],
    headline: ["Made for edges", "Carry less", "Built for the ridge"],
    sub: [
      "Quiet technical layers for long days outside.",
      "Shell, pack and boot, in one calm system.",
    ],
    cta: ["View gear", "Shop carry", "Open the pack"],
    manifesto: [
      "Carry less.",
      "Weight is a cost.",
      "Layers do the work.",
      "Leave no trace.",
      "Check the forecast twice.",
    ],
    about: [
      "About Mesa Form",
      [
        "We make outdoor and tech wear that disappears into the day. Names are one word. Specs are short.",
      ],
    ],
    band: ["Light and fast", "Field tested", "Mesa Form"],
    newsletter: ["Trail notes", "New gear and route notes, rarely."],
    cta2: ["Gear up", "Free returns for thirty days."],
    press: ["Light enough to forget.", "Calm under weather."],
    rating: ["M", "Mild weather", "Rated for rain and wind"],
    faq: "Gear questions",
    tear: ["Ridgeline", "Light and fast"],
  },
  "ace-row": {
    eyebrow: ["Spring 2027", "New in", "Season edit"],
    headline: ["Dress for the light", "Ace of every row", "Cut sharp, worn soft"],
    sub: [
      "Confident cuts in cream and ink, tiny labels, exact fits.",
      "An editorial wardrobe for ordinary days.",
    ],
    cta: ["Shop women", "Shop men", "See the edit"],
    manifesto: [
      "Fit first.",
      "Good cloth lasts.",
      "Neutral is a choice.",
      "Tailor everything.",
      "Wear it twice a week.",
    ],
    about: [
      "About Ace Row",
      [
        "Ace Row is a fashion store with a shield for a heart. Headlines are statements. Labels are tiny and exact.",
      ],
    ],
    band: ["Trending now", "New in", "2027 collections"],
    newsletter: ["Join the row", "Season previews, first."],
    cta2: ["Find your fit", "Free alterations on every order."],
    press: ["Cut like a promise.", "Quiet, then loud."],
    rating: ["A", "Ace rated", "Tested on real shoulders"],
    faq: "Fit and care",
    tear: ["New in", "Season edit"],
  },
  "smudge-club": {
    eyebrow: ["Drop 05", "Spec", "Court side"],
    headline: ["Spray first, ask later", "Smudge the rules", "Deadpan sportswear"],
    sub: [
      "Hairline type, spray paint, and a very white page.",
      "Sportswear with the volume turned down except the paint.",
    ],
    cta: ["Shop drop", "See specs", "Get gear"],
    manifesto: [
      "Paint is a spec.",
      "Pockets are mandatory.",
      "Warm up, then smudge.",
      "Stay out of the lines.",
      "Wash cold.",
    ],
    about: [
      "About Smudge Club",
      [
        "Smudge Club makes sportswear with a spray paint voice. Labels in caps, specs as plain lists, one shout per page.",
      ],
    ],
    band: ["Spray on cotton", "Court side", "Smudge Club"],
    newsletter: ["Join the club", "Drops, never daily."],
    cta2: ["Get the drop", "Ships with a patch."],
    press: ["The paint is the point.", "Technical and rude."],
    rating: ["S", "Smudge certified", "May contain overspray"],
    faq: "Spec questions",
    tear: ["Spray first", "Drop 05"],
  },
};

export const KNOWN_BRANDS = Object.keys(COPY);

export const slugifyBrand = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const titleCase = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

function genericBrand(id: string): ResolvedBrand {
  const name = titleCase(id) || "This brand";
  return {
    id,
    known: false,
    facts: {
      about: "a brand with no authored profile; treat it as calm and photo-free",
      photo: false,
      note: "no brand photography is known; product mockups only",
    },
    profile: { energy: ["calm"], surface: ["flat"], photo: false, fullBleedOk: false },
    copy: {
      eyebrow: ["New in", "This week", "Field notes"],
      headline: [`Meet ${name}`, "Made with intent", "Simple, on purpose"],
      sub: [`${name}, in a few well-made things.`, "Short list, careful details."],
      cta: ["Shop now", "See the range", "Browse all"],
      manifesto: [
        "Make less, better.",
        "Say it plainly.",
        "Details are the product.",
        "Ship when it is ready.",
        "Keep it useful.",
      ],
      about: [`About ${name}`, [`${name} makes a short list of things and does them carefully.`]],
      band: [name, "New in", "Made on purpose"],
      newsletter: [`Join ${name}`, "Occasional news, never daily."],
      cta2: ["See the range", "Free returns for thirty days."],
      press: ["Plain and well made.", "Nothing extra."],
      rating: [name.slice(0, 1).toUpperCase() || "N", name, "Handle with care"],
      faq: "Questions",
      tear: ["New in", "Made on purpose"],
    },
  };
}

export function resolveBrand(name: string): ResolvedBrand {
  const id = slugifyBrand(name);
  const facts = FACTS[id],
    profile = PROFILES[id],
    copy = COPY[id];
  if (!facts || !profile || !copy) return genericBrand(id || "brand");
  return { id, known: true, facts, profile, copy };
}
