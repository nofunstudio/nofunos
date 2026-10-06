// Where the live No Fun component library lives and which revision of it a build saw. The checkout is
// read-only to us: we bundle straight from its sources and node_modules and never run its scripts.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const DEFAULT_COMPONENTS_DIR = "/Users/nofun/Documents/GitHub/nofun-components";

/** The nofun-components checkout: `NOFUN_COMPONENTS_DIR`, else the owner's default path. */
export function componentsDir(): string {
  const dir = process.env.NOFUN_COMPONENTS_DIR?.trim() || DEFAULT_COMPONENTS_DIR;
  return NodePath.resolve(dir);
}

export function assertComponentsDir(dir = componentsDir()): string {
  if (!NodeFs.existsSync(NodePath.join(dir, "registry.json"))) {
    throw new Error(
      `No nofun-components checkout at ${dir} (registry.json missing). Set NOFUN_COMPONENTS_DIR to the checkout.`,
    );
  }
  if (!NodeFs.existsSync(NodePath.join(dir, "node_modules", "react"))) {
    throw new Error(`${dir} has no node_modules; install its dependencies there first.`);
  }
  return dir;
}

let stampCache: { dir: string; at: number; stamp: Promise<string> } | undefined;
const STAMP_TTL_MS = 2_000;

/**
 * HEAD plus a hash of the dirty state (status lines and the size/mtime of each dirty file), so an edit,
 * a new component or a pull invalidates every cache keyed on it. Re-read at most every two seconds.
 */
export function sourceStamp(dir = componentsDir()): Promise<string> {
  const now = Date.now();
  if (stampCache && stampCache.dir === dir && now - stampCache.at < STAMP_TTL_MS) {
    return stampCache.stamp;
  }
  const stamp = (async () => {
    const git = (args: string[]) =>
      run("git", ["-C", dir, ...args], { maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout);
    const [head, status] = await Promise.all([
      git(["rev-parse", "HEAD"]).catch(() => "nogit"),
      git(["status", "--porcelain", "--untracked-files=all"]).catch(() => ""),
    ]);
    const hash = createHash("sha256").update(head.trim());
    for (const line of status.split("\n")) {
      if (!line) continue;
      hash.update(line);
      const file = line.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, "");
      try {
        const stat = NodeFs.statSync(NodePath.join(dir, file));
        hash.update(`${stat.size}:${stat.mtimeMs}`);
      } catch {
        hash.update("gone");
      }
    }
    return `${head.trim().slice(0, 12)}-${hash.digest("hex").slice(0, 12)}`;
  })();
  stampCache = { dir, at: now, stamp };
  stamp.catch(() => {
    if (stampCache?.stamp === stamp) stampCache = undefined;
  });
  return stamp;
}

/** Memoizes one value per source stamp; a new stamp drops the old value. */
export function perStamp<T>(build: (dir: string, stamp: string) => Promise<T>) {
  let cached: { key: string; value: Promise<T> } | undefined;
  return async (): Promise<T> => {
    const dir = assertComponentsDir();
    const stamp = await sourceStamp(dir);
    const key = `${dir}@${stamp}`;
    if (cached?.key !== key) {
      const value = build(dir, stamp);
      cached = { key, value };
      value.catch(() => {
        if (cached?.value === value) cached = undefined;
      });
    }
    return cached.value;
  };
}

/** Memoizes many values per source stamp, keyed by `id`. */
export function perStampMap<T>(build: (dir: string, stamp: string, id: string) => Promise<T>) {
  let cached: { key: string; values: Map<string, Promise<T>> } | undefined;
  return async (id: string): Promise<T> => {
    const dir = assertComponentsDir();
    const stamp = await sourceStamp(dir);
    const key = `${dir}@${stamp}`;
    if (cached?.key !== key) cached = { key, values: new Map() };
    const values = cached.values;
    let value = values.get(id);
    if (!value) {
      value = build(dir, stamp, id);
      values.set(id, value);
      const settled = value;
      settled.catch(() => {
        if (values.get(id) === settled) values.delete(id);
      });
    }
    return value;
  };
}
