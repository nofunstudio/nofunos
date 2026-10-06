// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// Jev (typesafe-ai/jev through the Vercel AI Gateway) as an OPTIONAL fast variant generator and text-only
// pre-screen. Everything Jev-specific lives in this file so it can be deleted without touching the rest of the
// page tools: Claude is the default page author; Jev only selects and orders pre-built candidates.
//
// Gateway key: T3's own secret store (<state dir>/secrets/nofun-ai-gateway.bin, imported once with
// scripts/nofun/import-gateway-key.ts). NOFUN_GATEWAY_ENV_FILE is an explicit fallback that reads only the
// AI_GATEWAY_API_KEY line. Held in memory, never logged, printed or persisted. Each gateway request is logged (no key, no prompt bodies)
// as one JSON line in <state dir>/nofun/jev-ledger.jsonl.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  experimental_composeSpec as composeSpec,
  experimental_createEvaluator as createEvaluator,
  type Experimental_CompositionCatalog,
  type Experimental_CompositionEvaluator,
} from "@json-render/core";
import { z } from "zod";

import type { Candidate } from "./candidates.ts";
import { countFlaws, enforcePage, pageFeatures, type BrandPool } from "./compose.ts";
import { blockTags } from "./ontologyFilter.ts";
import { childrenOf, summarize, type FlatSpec } from "./spec.ts";

export const JEV_MODEL = "typesafe-ai/jev";
export const GATEWAY_SECRET_NAME = "nofun-ai-gateway";
const KEY_NAME = "AI_GATEWAY_API_KEY";

export class JevUnavailableError extends Error {
  constructor(reason: string) {
    super(`Jev unavailable: ${reason}. nofun_page_compose and nofun_page_catalog still work.`);
    this.name = "JevUnavailableError";
  }
}

/** Reads the key from T3's secret store, else from the AI_GATEWAY_API_KEY line of NOFUN_GATEWAY_ENV_FILE. */
export async function readGatewayKey(
  stateDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  try {
    const stored = (
      await NodeFSP.readFile(
        NodePath.join(stateDir, "secrets", `${GATEWAY_SECRET_NAME}.bin`),
        "utf8",
      )
    ).trim();
    if (stored) return stored;
  } catch {
    // Not imported yet; try the explicit env-file fallback.
  }
  const file = env.NOFUN_GATEWAY_ENV_FILE?.trim();
  if (!file) {
    throw new JevUnavailableError(
      "no gateway key in T3's secret store (run node scripts/nofun/import-gateway-key.ts)",
    );
  }
  let text: string;
  try {
    text = await NodeFSP.readFile(file, "utf8");
  } catch {
    throw new JevUnavailableError("the NOFUN_GATEWAY_ENV_FILE file could not be read");
  }
  for (const line of text.split("\n")) {
    const m = line.match(new RegExp(`^\\s*(?:export\\s+)?${KEY_NAME}\\s*=\\s*(.*?)\\s*$`));
    if (m?.[1]) {
      const value = m[1].replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }
  throw new JevUnavailableError(`${KEY_NAME} is not set in the gateway env file`);
}

export interface LedgerRow {
  readonly time: string;
  readonly requests: number;
  readonly inputTokens: number | null;
  readonly purpose: string;
}

const ledgerPath = (stateDir: string) => NodePath.join(stateDir, "nofun", "jev-ledger.jsonl");

async function writeLedger(stateDir: string, row: LedgerRow) {
  try {
    await NodeFSP.mkdir(NodePath.dirname(ledgerPath(stateDir)), { recursive: true });
    await NodeFSP.appendFile(ledgerPath(stateDir), `${JSON.stringify(row)}\n`);
  } catch {
    // A ledger write must never fail a page; the request already happened.
  }
}

/**
 * Evaluator that logs every gateway request to the ledger and stops past a request budget. `forPurpose` returns an
 * evaluator that logs its own label, so concurrent compositions do not overwrite each other's ledger rows.
 */
export async function makeEvaluator(stateDir: string, purpose: { value: string }, budget: number) {
  const apiKey = await readGatewayKey(stateDir);
  const base = createEvaluator({ model: JEV_MODEL, apiKey, timeoutMs: 60_000 });
  let used = 0;
  const forPurpose =
    (label: () => string): Experimental_CompositionEvaluator =>
    async (req) => {
      if (used >= budget) throw new Error(`Jev request budget of ${budget} reached`);
      used++;
      const purposeLabel = label();
      let inputTokens: number | null = null;
      try {
        const res = await base(req);
        inputTokens = res.usage?.inputTokens ?? null;
        return res;
      } finally {
        await writeLedger(stateDir, {
          time: new Date().toISOString(),
          requests: 1,
          inputTokens,
          purpose: purposeLabel,
        });
      }
    };
  return {
    evaluate: forPurpose(() => purpose.value),
    forPurpose: (label: string) => forPurpose(() => label),
    requestsUsed: () => used,
  };
}

/**
 * composeSpec only needs each block's name, slots and a props schema. Candidates are app-owned and already carry
 * concrete props, so props are validated loosely here; the real prop contract is the compiler's.
 */
function jevCatalog(pool: BrandPool): Experimental_CompositionCatalog {
  const types = new Set(pool.all.map((c) => c.element.type));
  const components: Experimental_CompositionCatalog["data"]["components"] = {};
  for (const t of types)
    components[t] = { props: z.looseObject({}), ...(t === "Page" ? { slots: ["default"] } : {}) };
  return {
    data: { components },
    validate: (spec) => {
      const s = spec as FlatSpec;
      const ok =
        typeof s?.root === "string" &&
        !!s.elements?.[s.root] &&
        Object.values(s.elements).every((e) => types.has(e.type));
      return { success: ok };
    },
  };
}

const INTENT: Record<string, string> = {
  drop: "It is a drop-day page: one buying moment and one loud moment where the brand allows it.",
  editorial: "It is a calm editorial page: quiet pacing, words and imagery doing the work.",
};

const promptFor = (brandId: string, about: string, brief: string, intent: string) =>
  `A landing page for ${brandId.replace(/-/g, " ")}, ${about}. Brief: ${brief}. ${INTENT[intent] ?? INTENT.drop} Use exactly these sections, top to bottom: nav, one hero, one product section, one story section (manifesto or about), one voice section (press quotes, proof or FAQ), one divider, one closing band, footer. Choose one candidate for every section. Do not repeat the products the hero already shows.`;

/** Rotates the order of candidates inside each slot so variant N does not always see the same first choice. */
function rotated(kept: ReadonlyArray<Candidate>, seed: number): Candidate[] {
  const bySlot = new Map<string, Candidate[]>();
  for (const c of kept)
    (
      bySlot.get(c.resource ?? c.id) ?? bySlot.set(c.resource ?? c.id, []).get(c.resource ?? c.id)!
    ).push(c);
  const out: Candidate[] = [];
  for (const group of bySlot.values()) {
    const k = seed % group.length;
    out.push(...group.slice(k), ...group.slice(0, k));
  }
  return out;
}

export interface Variant {
  readonly index: number;
  readonly intent: string;
  readonly spec: FlatSpec;
  readonly blocks: string[];
  readonly flaws: number;
}

/** One Jev composition (about 2 gateway requests). Throws on provider errors; returns null when no spec came back. */
export async function composeVariant(
  pool: BrandPool,
  brief: string,
  index: number,
  evaluate: Experimental_CompositionEvaluator,
): Promise<Variant | null> {
  const intent = index % 2 === 0 ? "drop" : "editorial";
  const candidates = rotated(pool.kept, index);
  let last: FlatSpec | null = null;
  let done: FlatSpec | null | undefined;
  for await (const ev of composeSpec({
    catalog: jevCatalog(pool),
    candidates,
    evaluate,
    prompt: promptFor(pool.brand.id, pool.brand.facts.about, brief, intent),
    strategy: "batch",
    maxSteps: 14,
    context: {
      brand: pool.brand.id,
      about: pool.brand.facts.about,
      energy: pool.brand.profile.energy,
      surface: pool.brand.profile.surface,
      hasBrandPhoto: pool.brand.facts.photo,
    },
  })) {
    if (ev.type === "step") last = ev.spec as unknown as FlatSpec;
    else done = ev.spec as unknown as FlatSpec | null;
  }
  const raw = done ?? last;
  if (!raw) return null;
  const { spec } = enforcePage(pool, raw);
  return {
    index,
    intent,
    spec,
    blocks: summarize(spec),
    flaws: countFlaws(pageFeatures(spec, pool.brand)),
  };
}

export type Verdict = "strong" | "good" | "weak" | "reject";
const LEVEL: Record<Verdict, number> = { strong: 3, good: 2, weak: 1, reject: 0 };
const CRITERIA: Record<Verdict, string> = {
  strong:
    "A page a designer would ship: one hero, one clear buying moment, a rhythm of different section types, tone matches the brand profile, no repeats.",
  good: "Works, with at most one small flaw (a section type that is slightly off tone, or thin depth).",
  weak: "Visibly flawed: the same product content shown twice, a loud block on a calm brand, a photo hero where the brand has no photo, or stacked loud dividers.",
  reject:
    "Broken: missing nav or footer, repeated product sections plus a mismatched hero, or an empty or degenerate block.",
};

export interface Judged {
  readonly verdict: Verdict | null;
  readonly confidence: number | null;
  readonly score: number;
}

/** Text-only pre-screen: block order, variants, ontology tags and the brand profile. One request per call (<= 10 pages). */
export async function judgePages(
  pool: BrandPool,
  pages: ReadonlyArray<{ readonly id: string; readonly spec: FlatSpec }>,
  evaluate: Experimental_CompositionEvaluator,
): Promise<Record<string, Judged>> {
  const state: Record<string, unknown> = {};
  const questions: Record<
    string,
    { type: "choice"; instructions: string; criteria: Record<string, string> }
  > = {};
  for (const { id, spec } of pages) {
    state[id] = {
      brand: {
        name: pool.brand.id,
        ...pool.brand.profile,
        hasBrandPhoto: pool.brand.facts.photo,
        photoNote: pool.brand.facts.note,
      },
      blocks: childrenOf(spec).map((e) => {
        const variant = typeof e.props.variant === "string" ? e.props.variant : undefined;
        return { type: e.type, variant: variant ?? null, ...blockTags(e.type, variant) };
      }),
    };
    questions[id] = {
      type: "choice",
      instructions: `Rate the landing page \`${id}\` for brand ${pool.brand.id} from the block order, variants, block energy and surface tags, and the brand profile. Consider: nav first, footer last, one hero, a mix of section types, whether two sections would show the same products, block energy against brand energy, a photo hero only if the brand has a photo.`,
      criteria: CRITERIA,
    };
  }
  const res = await evaluate({ state, questions, signal: AbortSignal.timeout(60_000) });
  const out: Record<string, Judged> = {};
  for (const { id } of pages) {
    const a = res.answers[id];
    const v = a && a.choice in LEVEL ? (a.choice as Verdict) : null;
    const conf = a?.confidence ?? null;
    out[id] = {
      verdict: v,
      confidence: conf,
      score: v === null ? -1 : LEVEL[v] + (conf ?? 0.5) * (LEVEL[v] >= 2 ? 0.25 : -0.25),
    };
  }
  return out;
}

export const isWeak = (j: Judged) =>
  j.verdict === null || j.verdict === "weak" || j.verdict === "reject";
