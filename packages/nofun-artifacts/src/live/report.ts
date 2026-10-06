// The isolation compile report `sync` writes: which indexed components compile on their own. Search
// leaves the failures out so agents are not pointed at components that cannot build.
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

export const GENERATED_DIR = NodePath.join(
  NodePath.dirname(NodePath.dirname(NodePath.dirname(fileURLToPath(import.meta.url)))),
  "generated",
);
export const COMPILE_REPORT_FILE = NodePath.join(GENERATED_DIR, "compile-report.json");
export const INDEX_FILE = NodePath.join(GENERATED_DIR, "index.json");

export interface CompileReport {
  readonly source: string;
  readonly generatedAt: string;
  readonly total: number;
  readonly compiled: number;
  readonly rendered?: number;
  readonly failures: ReadonlyArray<{
    readonly name: string;
    readonly stage: "compile" | "render";
    readonly reason: string;
  }>;
}

let cached: { mtime: number; report: CompileReport | undefined } | undefined;

export function readCompileReport(): CompileReport | undefined {
  let mtime = 0;
  try {
    mtime = NodeFs.statSync(COMPILE_REPORT_FILE).mtimeMs;
  } catch {
    return undefined;
  }
  if (cached?.mtime !== mtime) {
    try {
      cached = {
        mtime,
        report: JSON.parse(NodeFs.readFileSync(COMPILE_REPORT_FILE, "utf8")) as CompileReport,
      };
    } catch {
      cached = { mtime, report: undefined };
    }
  }
  return cached.report;
}
