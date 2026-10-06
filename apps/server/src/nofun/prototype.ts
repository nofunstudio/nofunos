// Fast first-iteration page prototypes: the controller writes real section components, Jev (or a deterministic
// rhythm when Jev is unavailable) only decides which sections go in and in what order. Layout rules are enforced
// here in code. Each layout becomes one TSX module that bundles its sections as closures, so sections cannot
// collide on top-level names.
import {
  experimental_composeSpec as composeSpec,
  type Experimental_CompositionCatalog,
  type Experimental_CompositionEvaluator,
} from "@json-render/core";
import { z } from "zod";

export interface PrototypeSection {
  readonly id: string;
  readonly title: string;
  readonly role?: string | undefined;
  readonly tsx: string;
}

export const MIN_SECTIONS = 3;

const ROLE_RANK: Record<string, number> = {
  header: 0,
  metrics: 1,
  media: 2,
  chart: 3,
  story: 4,
  table: 5,
  cta: 6,
  footer: 9,
};
const rankOf = (s: PrototypeSection) => ROLE_RANK[s.role ?? ""] ?? 4;

/**
 * Header first, footer last, no duplicates, unknown ids dropped, at least MIN_SECTIONS (padded by the base
 * rhythm), `required` ids always present.
 */
export function enforceOrder(
  ids: ReadonlyArray<string>,
  sections: ReadonlyArray<PrototypeSection>,
  required: ReadonlyArray<string> = [],
): string[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const seen = new Set<string>();
  let order = ids.filter((id) => byId.has(id) && !seen.has(id) && !!seen.add(id));
  for (const id of required) if (byId.has(id) && !seen.has(id)) (seen.add(id), order.push(id));
  if (order.length < MIN_SECTIONS) {
    for (const s of baseOrder(sections)) {
      if (order.length >= MIN_SECTIONS) break;
      if (!seen.has(s.id)) (seen.add(s.id), order.push(s.id));
    }
  }
  const role = (id: string) => byId.get(id)?.role;
  const header = order.find((id) => role(id) === "header");
  const footer = order.find((id) => role(id) === "footer");
  order = order.filter((id) => id !== header && id !== footer);
  return [...(header ? [header] : []), ...order, ...(footer ? [footer] : [])];
}

/** Role-based rhythm: header, metrics, media, chart, story, table, cta, footer; ties keep input order. */
export const baseOrder = (sections: ReadonlyArray<PrototypeSection>) =>
  sections
    .map((s, i) => ({ s, i }))
    .toSorted((a, b) => rankOf(a.s) - rankOf(b.s) || a.i - b.i)
    .map(({ s }) => s);

/** `count` distinct deterministic layouts: the base rhythm, then rotations and reversals of its middle. */
export function deterministicOrders(
  sections: ReadonlyArray<PrototypeSection>,
  count: number,
  required: ReadonlyArray<string> = [],
): string[][] {
  const base = baseOrder(sections).map((s) => s.id);
  const role = new Map(sections.map((s) => [s.id, s.role]));
  const head = base.filter((id) => role.get(id) === "header");
  const foot = base.filter((id) => role.get(id) === "footer");
  const middle = base.filter((id) => role.get(id) !== "header" && role.get(id) !== "footer");
  const out: string[][] = [];
  const seen = new Set<string>();
  const push = (mid: string[]) => {
    const order = enforceOrder([...head, ...mid, ...foot], sections, required);
    const key = order.join("|");
    if (!seen.has(key)) (seen.add(key), out.push(order));
  };
  for (let k = 0; k < middle.length * 2 && out.length < count; k++) {
    const r = k % middle.length;
    const rotated = [...middle.slice(r), ...middle.slice(0, r)];
    push(k < middle.length ? rotated : rotated.toReversed());
  }
  // Shorter layouts (drop one optional middle section) add variety when rotations run out.
  for (let k = 0; k < middle.length && out.length < count; k++) {
    if (middle.length - 1 < MIN_SECTIONS - head.length - foot.length) break;
    if (required.includes(middle[k]!)) continue;
    push(middle.filter((_, i) => i !== k));
  }
  return out.slice(0, count);
}

const ANGLES = [
  "Lead with the strongest evidence: the headline numbers first.",
  "Lead with the story: context first, data after.",
  "Dense and data-first: put charts and tables early.",
  "Visual first: media and charts before text-heavy sections.",
  "Calm and sparse: fewer sections, clear breathing room.",
  "Action-oriented: the call to action is prominent and the page builds toward it.",
  "Balanced: alternate text-heavy and visual sections.",
  "Surprising but coherent: an unexpected order that still reads as one argument.",
];

function jevCatalog(): Experimental_CompositionCatalog {
  return {
    data: {
      components: {
        Page: { props: z.looseObject({}), slots: ["default"] },
        Section: { props: z.looseObject({}) },
      },
    },
    validate: (spec) => {
      const s = spec as {
        root?: string;
        elements?: Record<string, { type: string }>;
      };
      const ok =
        typeof s?.root === "string" &&
        !!s.elements?.[s.root] &&
        Object.values(s.elements).every((e) => e.type === "Page" || e.type === "Section");
      return { success: ok };
    },
  };
}

/** One Jev composition (about 2 gateway requests): the ordered section ids it picked. Throws on provider errors. */
export async function jevOrder(
  sections: ReadonlyArray<PrototypeSection>,
  brief: string,
  index: number,
  evaluate: Experimental_CompositionEvaluator,
): Promise<string[] | null> {
  // Rotate the candidate list so variant N does not always see the same first choice.
  const r = index % sections.length;
  const rotated = [...sections.slice(r), ...sections.slice(0, r)];
  const candidates = [
    {
      id: "page",
      description: "The page frame that holds the sections from top to bottom",
      element: { type: "Page", props: {} },
      root: true,
    },
    ...rotated.map((s) => ({
      id: s.id,
      description: `${s.title}${s.role ? ` (role: ${s.role})` : ""}`,
      element: { type: "Section", props: { id: s.id, title: s.title, role: s.role ?? "story" } },
      root: false,
    })),
  ];
  let last: unknown;
  let done: unknown;
  for await (const ev of composeSpec({
    catalog: jevCatalog(),
    candidates,
    evaluate,
    prompt: `A page prototype. Brief: ${brief}. Choose at least ${MIN_SECTIONS} of the sections and order them top to bottom so the page reads as one argument; use each at most once. ${ANGLES[index % ANGLES.length]}`,
    strategy: "batch",
    maxSteps: 10,
    context: { sectionRoles: sections.map((s) => ({ id: s.id, role: s.role ?? "story" })) },
  })) {
    if (ev.type === "step") last = ev.spec;
    else done = ev.spec;
  }
  const raw = (done ?? last) as
    | {
        root: string;
        elements: Record<
          string,
          { type: string; props?: { id?: unknown }; children?: ReadonlyArray<string> }
        >;
      }
    | null
    | undefined;
  if (!raw?.elements?.[raw.root]) return null;
  const ids: string[] = [];
  for (const key of raw.elements[raw.root]!.children ?? []) {
    const el = raw.elements[key];
    const id = typeof el?.props?.id === "string" ? el.props.id : key.replace(/-\d+$/, "");
    ids.push(id);
  }
  return ids;
}

// ---- TSX bundling ----

interface ImportSet {
  readonly defaults: Set<string>;
  readonly namespaces: Set<string>;
  readonly named: Set<string>;
}

const FROM_IMPORT = /^[ \t]*import\s+([^"';]*?)\s+from\s+["']([^"']+)["'];?[ \t]*$/gm;
const SIDE_IMPORT = /^[ \t]*import\s+["']([^"']+)["'];?[ \t]*$/gm;

/** Hoists every import into one deduplicated block; returns the body without them. */
function hoistImports(tsx: string, into: Map<string, ImportSet>, side: Set<string>): string {
  const set = (mod: string) => {
    let s = into.get(mod);
    if (!s) into.set(mod, (s = { defaults: new Set(), namespaces: new Set(), named: new Set() }));
    return s;
  };
  return tsx
    .replace(SIDE_IMPORT, (_m, mod: string) => (side.add(mod), ""))
    .replace(FROM_IMPORT, (_m, clause: string, mod: string) => {
      const target = set(mod);
      const c = clause.trim();
      const named = c.match(/\{([\s\S]*)\}/);
      const rest = c
        .replace(/\{[\s\S]*\}/, "")
        .replace(/,\s*$/, "")
        .trim();
      for (const n of named?.[1]?.split(",") ?? []) {
        const name = n.trim().replace(/\s+/g, " ");
        if (name) target.named.add(name);
      }
      const ns = rest.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
      if (ns) target.namespaces.add(ns[1]!);
      else if (rest) target.defaults.add(rest.replace(/,$/, "").trim());
      return "";
    });
}

/** Turns the default export into a plain declaration and returns the component's name. */
function unexport(body: string, fallback: string): { code: string; name: string } | null {
  let name: string | undefined;
  let code = body.replace(
    /^[ \t]*export\s+default\s+(async\s+)?(function\*?|class)\s+([A-Za-z_$][\w$]*)/m,
    (_m, a: string | undefined, kind: string, n: string) => ((name = n), `${a ?? ""}${kind} ${n}`),
  );
  if (!name) {
    code = code.replace(
      /^[ \t]*export\s+default\s+(async\s+)?(function\*?|class)\s*([(<{])/m,
      (_m, a: string | undefined, kind: string, p: string) => (
        (name = fallback),
        `${a ?? ""}${kind} ${fallback}${p}`
      ),
    );
  }
  if (!name) {
    code = code.replace(
      /^[ \t]*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?[ \t]*$/m,
      (_m, n: string) => ((name = n), ""),
    );
  }
  if (!name) {
    code = code.replace(
      /^[ \t]*export\s+default\s+/m,
      () => ((name = fallback), `const ${fallback} = `),
    );
  }
  if (!name) return null;
  return { code: code.replace(/^([ \t]*)export\s+(?!default\b)/gm, "$1"), name };
}

/** One TSX module that renders `ordered` top to bottom. Throws naming a section with no default export. */
export function bundleSections(ordered: ReadonlyArray<PrototypeSection>): string {
  const imports = new Map<string, ImportSet>();
  const side = new Set<string>();
  const blocks: string[] = [];
  ordered.forEach((s, i) => {
    const body = hoistImports(s.tsx, imports, side);
    const ex = unexport(body, "__Section");
    if (!ex) throw new Error(`Section "${s.id}" has no default export.`);
    blocks.push(`const Section${i} = (() => {\n${ex.code}\nreturn ${ex.name};\n})();`);
  });
  const lines: string[] = [];
  for (const mod of side) lines.push(`import "${mod}";`);
  for (const [mod, s] of imports) {
    const parts: string[] = [...s.defaults, ...[...s.namespaces].map((n) => `* as ${n}`)];
    if (s.named.size > 0) parts.push(`{ ${[...s.named].join(", ")} }`);
    // A default and a namespace cannot share one statement with more than one default; emit one per binding.
    if (s.defaults.size + s.namespaces.size > 1) {
      for (const d of s.defaults) lines.push(`import ${d} from "${mod}";`);
      for (const n of s.namespaces) lines.push(`import * as ${n} from "${mod}";`);
      if (s.named.size > 0) lines.push(`import { ${[...s.named].join(", ")} } from "${mod}";`);
    } else lines.push(`import ${parts.join(", ")} from "${mod}";`);
  }
  const page = `export default function Prototype() {\n  return (\n    <main className="flex min-h-screen flex-col">\n${ordered
    .map((_, i) => `      <Section${i} />`)
    .join("\n")}\n    </main>\n  );\n}`;
  return `${lines.join("\n")}\n\n${blocks.join("\n\n")}\n\n${page}\n`;
}
