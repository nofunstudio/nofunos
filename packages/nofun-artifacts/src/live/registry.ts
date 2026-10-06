// The live component index: every registry.json item except commerce, described from registry.json,
// the ontology (public/r/ontology.json, schema docs/ontology/SCHEMA.md) and each block's README.
// Read straight from the checkout and rebuilt whenever its source stamp changes, so a component the
// owner adds shows up without any edit here.
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { perStamp } from "./source.ts";

/** Commerce groups are kept out of the index (their libs stay importable as block dependencies). */
export const EXCLUDED_CATEGORIES = new Set(["product", "pdp", "customizer"]);

export type IndexKind = "block" | "component" | "lib" | "brand" | "item";

export interface IndexProp {
  readonly name: string;
  readonly type?: string;
  readonly default?: string;
  readonly description?: string;
}

export interface IndexEntry {
  readonly name: string;
  readonly kind: IndexKind;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  /** `@nofun/ui/<name>`; empty for brands (use them as `theme`/`brand`). */
  readonly import: string;
  /** The checkout-relative main file. */
  readonly file: string;
  readonly exports: ReadonlyArray<string>;
  readonly mainComponent?: string;
  readonly demo?: { readonly import: string; readonly export: string };
  readonly style: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly props: ReadonlyArray<IndexProp>;
  readonly client: boolean;
  /** Brand id for `kind: "brand"`. */
  readonly brand?: string;
}

export interface LiveIndex {
  readonly dir: string;
  readonly stamp: string;
  readonly entries: ReadonlyArray<IndexEntry>;
  readonly byName: ReadonlyMap<string, IndexEntry>;
  /** Every registry name (commerce included) to its main file, for import resolution. */
  readonly files: ReadonlyMap<string, { readonly file: string; readonly category: string }>;
  readonly brands: ReadonlyArray<string>;
}

type RegistryItem = {
  name: string;
  type: string;
  title?: string;
  description?: string;
  categories?: string[];
  files?: { path: string; type?: string }[];
};

type OntologyItem = {
  slug: string;
  description?: string;
  intent?: string;
  style?: string[];
  tags?: string[];
  props?: IndexProp[];
  mainComponent?: string;
  client?: boolean;
};

const readJson = <T>(file: string): T | undefined => {
  try {
    return JSON.parse(NodeFs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const EXPORT_DECL =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;

/** Value exports of a module, scanned from source (types are skipped). */
export function scanExports(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(EXPORT_DECL)) names.add(match[1]!);
  for (const match of source.matchAll(EXPORT_LIST)) {
    for (const part of match[1]!.split(",")) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith("type ")) continue;
      const alias = trimmed
        .split(/\s+as\s+/)
        .pop()!
        .trim();
      if (alias && alias !== "default") names.add(alias);
    }
  }
  return [...names];
}

function mainFile(item: RegistryItem): string | undefined {
  const files = (item.files ?? []).map((f) => f.path).filter((p) => /\.(tsx|ts)$/.test(p));
  return (
    files.find((p) => p.endsWith(`/${item.name}.tsx`)) ??
    files.find((p) => p.endsWith(`/${item.name}.ts`)) ??
    files.find((p) => !/\/(demo|meta)\.tsx?$/.test(p)) ??
    files[0]
  );
}

function readmeSummary(dir: string): string {
  const text = (() => {
    try {
      return NodeFs.readFileSync(NodePath.join(dir, "README.md"), "utf8");
    } catch {
      return "";
    }
  })();
  const paragraph = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("```") && !p.startsWith("|"));
  return paragraph ? paragraph.replace(/\s+/g, " ").slice(0, 400) : "";
}

function kindOf(item: RegistryItem): IndexKind {
  if (item.type === "registry:block") return "block";
  if (item.type === "registry:component") return "component";
  if (item.type === "registry:lib") return "lib";
  if (item.name.startsWith("design-system-")) return "brand";
  return "item";
}

export function buildIndex(dir: string, stamp: string): LiveIndex {
  const registry = readJson<{ items: RegistryItem[] }>(NodePath.join(dir, "registry.json"));
  if (!registry) throw new Error(`Cannot read ${dir}/registry.json`);
  const ontology = readJson<{ items: OntologyItem[] }>(
    NodePath.join(dir, "public", "r", "ontology.json"),
  );
  const onto = new Map((ontology?.items ?? []).map((item) => [item.slug, item]));
  const entries: IndexEntry[] = [];
  const files = new Map<string, { file: string; category: string }>();
  const brands: string[] = [];
  for (const item of registry.items) {
    const category = item.categories?.[0] ?? (item.type === "registry:lib" ? "lib" : "item");
    const file = mainFile(item);
    if (file) files.set(item.name, { file, category });
    if (EXCLUDED_CATEGORIES.has(category)) continue;
    const kind = kindOf(item);
    const o = onto.get(item.name);
    const brand = kind === "brand" ? item.name.slice("design-system-".length) : undefined;
    if (brand) brands.push(brand);
    let exports: string[] = [];
    let demo: IndexEntry["demo"];
    let readme = "";
    if (file && (kind === "block" || kind === "component" || kind === "lib")) {
      const abs = NodePath.join(dir, file);
      try {
        exports = scanExports(NodeFs.readFileSync(abs, "utf8"));
      } catch {
        exports = [];
      }
      const blockDir = NodePath.dirname(abs);
      readme = readmeSummary(blockDir);
      try {
        const demoSource = NodeFs.readFileSync(NodePath.join(blockDir, "demo.tsx"), "utf8");
        const name = /^export\s+function\s+(\w+Demo)\b/m.exec(demoSource)?.[1];
        if (name) demo = { import: `@nofun/ui/${item.name}/demo`, export: name };
      } catch {
        // No demo for this item.
      }
    }
    const description = [o?.intent ?? o?.description ?? item.description ?? "", readme]
      .filter(Boolean)
      .filter((text, index, all) => all.indexOf(text) === index)
      .join(" ")
      .slice(0, 900);
    entries.push({
      name: item.name,
      kind,
      category,
      title: item.title ?? item.name,
      description,
      import: brand ? "" : `@nofun/ui/${item.name}`,
      file: file ?? "",
      exports,
      ...(o?.mainComponent ? { mainComponent: o.mainComponent } : {}),
      ...(demo ? { demo } : {}),
      style: o?.style ?? [],
      tags: [...new Set([...(item.categories ?? []).slice(1), ...(o?.tags ?? [])])],
      props: (o?.props ?? []).slice(0, 14),
      client: o?.client ?? true,
      ...(brand ? { brand } : {}),
    });
  }
  return {
    dir,
    stamp,
    entries,
    byName: new Map(entries.map((entry) => [entry.name, entry])),
    files,
    brands: brands.sort(),
  };
}

export const liveIndex = perStamp(async (dir, stamp) => buildIndex(dir, stamp));

/** Brand ids with a compiled sheet under registry/nofun-ui/themes/brands. */
export function brandIds(dir: string): string[] {
  try {
    return NodeFs.readdirSync(NodePath.join(dir, "registry", "nofun-ui", "themes", "brands"))
      .filter((file) => file.endsWith(".css") && file !== "index.css")
      .map((file) => file.slice(0, -4))
      .sort();
  } catch {
    return [];
  }
}

export interface BrandScheme {
  readonly schemes: ReadonlyArray<"light" | "dark">;
  readonly defaultScheme: "light" | "dark";
}

export function brandScheme(dir: string, brand: string): BrandScheme {
  const ds = readJson<{
    variables?: { schemes?: ("light" | "dark")[]; defaultScheme?: "light" | "dark" };
  }>(NodePath.join(dir, "registry", "nofun-ui", "design-systems", `${brand}.json`));
  const schemes = ds?.variables?.schemes ?? ["light", "dark"];
  return { schemes, defaultScheme: ds?.variables?.defaultScheme ?? schemes[0] ?? "light" };
}

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

/** Ranked matches for a free-text query, optionally within one category. */
export function searchIndex(
  entries: ReadonlyArray<IndexEntry>,
  query: string,
  options: {
    category?: string | undefined;
    limit?: number | undefined;
    exclude?: ReadonlySet<string>;
  } = {},
): IndexEntry[] {
  const terms = tokenize(query);
  const category = options.category?.toLowerCase();
  const scored: { entry: IndexEntry; score: number }[] = [];
  for (const entry of entries) {
    if (options.exclude?.has(entry.name)) continue;
    if (category && entry.category !== category && entry.kind !== category) continue;
    if (terms.length === 0) {
      scored.push({ entry, score: 1 });
      continue;
    }
    const fields: [string[], number][] = [
      [tokenize(entry.name), 6],
      [tokenize(entry.title), 5],
      [[entry.category, ...entry.tags].flatMap(tokenize), 3],
      [entry.style.flatMap(tokenize), 2],
      [tokenize(`${entry.mainComponent ?? ""} ${entry.exports.slice(0, 6).join(" ")}`), 2],
      [tokenize(entry.description), 1],
    ];
    let score = 0;
    for (const term of terms) {
      let best = 0;
      for (const [tokens, weight] of fields) {
        if (tokens.includes(term)) best = Math.max(best, weight);
        else if (tokens.some((t) => t.startsWith(term) || (term.length > 3 && t.includes(term))))
          best = Math.max(best, weight / 2);
      }
      score += best;
    }
    if (entry.kind === "block" || entry.kind === "component") score += 0.1;
    if (score > 0) scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, options.limit ?? 8)
    .map((s) => s.entry);
}
