// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// The No Fun artifact playbook lives in the owner's nofun-skills checkout and is read live (mtime-cached), never
// copied into this repo. The first nofun_* tool result in a thread carries it, so any provider (Claude, Codex,
// Cursor) starts from the same baseline without a skill loader. A missing skill file means nothing is added.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const DEFAULT_SKILLS_DIR = "/Users/nofun/Documents/GitHub/nofun-skills";
const PLAYBOOK_HEADING = "No Fun artifact playbook (loaded once per thread)";

const skillDir = (env: NodeJS.ProcessEnv = process.env) =>
  NodePath.join(
    env.NOFUN_SKILLS_DIR?.trim() || DEFAULT_SKILLS_DIR,
    "skills",
    "web",
    "nofun-artifacts",
  );

const cache = new Map<string, { readonly mtimeMs: number; readonly body: string }>();

/** File body without YAML frontmatter, re-read only when the file's mtime changes. Undefined when unreadable. */
function readBody(file: string): string | undefined {
  try {
    const { mtimeMs } = NodeFS.statSync(file);
    const hit = cache.get(file);
    if (hit?.mtimeMs === mtimeMs) return hit.body;
    const raw = NodeFS.readFileSync(file, "utf8");
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    cache.set(file, { mtimeMs, body });
    return body;
  } catch {
    return undefined;
  }
}

export const readPlaybook = () => readBody(NodePath.join(skillDir(), "SKILL.md"));

/** Reference names (file names without .md) in the skill's references directory. */
export function listReferences(): string[] {
  try {
    return NodeFS.readdirSync(NodePath.join(skillDir(), "references"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/** A reference by listed name only, so the name can never address another path. */
export function readReference(name: string): string | undefined {
  if (!listReferences().includes(name)) return undefined;
  return readBody(NodePath.join(skillDir(), "references", `${name}.md`));
}

const loaded = new Set<string>();

export interface PlaybookCaller {
  readonly thread?: { readonly threadId: string } | undefined;
  readonly client?: { readonly sessionId: string } | undefined;
}

const keyOf = (caller: PlaybookCaller) =>
  caller.thread
    ? `thread:${caller.thread.threadId}`
    : caller.client
      ? `client:${caller.client.sessionId}`
      : undefined;

/** Marks the thread as having the playbook (the design guide tool returns it explicitly). */
export function markPlaybookLoaded(caller: PlaybookCaller) {
  const key = keyOf(caller);
  if (key) loaded.add(key);
}

/**
 * Spread into a nofun_* tool result: `{ playbook }` on the first call in a thread, `{}` after that or when the
 * skill file is missing. Call it only on a successful result so a failed first call does not use up the load.
 */
export function playbookFor(caller: PlaybookCaller): { playbook?: string } {
  const key = keyOf(caller);
  if (!key || loaded.has(key)) return {};
  const body = readPlaybook();
  if (body === undefined) return {};
  loaded.add(key);
  return { playbook: `# ${PLAYBOOK_HEADING}\n\n${body}` };
}
