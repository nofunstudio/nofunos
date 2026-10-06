// The json-render page catalog (nofun-components experiments/json-render/catalog.ts), loaded in Node so
// the server can validate a page spec and describe the catalog to agents. It is bundled from the
// checkout (zod and @json-render/core from its node_modules) into a temp module per source stamp.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

import { perStamp } from "./source.ts";

type ZodIssue = { path: ReadonlyArray<PropertyKey>; message: string };

export interface PageCatalogModule {
  readonly catalog: {
    validate(spec: unknown): { success: boolean; error?: { issues: ReadonlyArray<ZodIssue> } };
    prompt(options?: Record<string, unknown>): string;
    readonly data?: { components?: Record<string, { description?: string }> };
  };
  validateSpec(spec: unknown): {
    valid: boolean;
    issues: ReadonlyArray<{ severity?: string; message: string }>;
  };
}

const ENTRY = `export { catalog } from "./experiments/json-render/catalog.ts";
export { validateSpec } from "@json-render/core";`;

export const pageCatalog = perStamp(async (dir, stamp): Promise<PageCatalogModule> => {
  const outDir = NodePath.join(NodeOs.tmpdir(), "nofun-artifacts");
  NodeFs.mkdirSync(outDir, { recursive: true });
  const outfile = NodePath.join(outDir, `page-catalog-${stamp}.mjs`);
  if (!NodeFs.existsSync(outfile)) {
    await esbuild.build({
      stdin: { contents: ENTRY, loader: "ts", resolveDir: dir, sourcefile: "page-catalog.ts" },
      absWorkingDir: dir,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: `${outfile}.tmp.mjs`,
      logLevel: "silent",
    });
    NodeFs.renameSync(`${outfile}.tmp.mjs`, outfile);
  }
  return (await import(pathToFileURL(outfile).href)) as PageCatalogModule;
});

/** Problems with a page spec, each naming its path; empty when the spec is valid. */
export async function pageSpecIssues(spec: unknown): Promise<string[]> {
  const mod = await pageCatalog();
  const issues: string[] = [];
  const result = mod.catalog.validate(spec);
  if (!result.success) {
    for (const issue of result.error?.issues ?? []) {
      issues.push(`${issue.path.map(String).join(".") || "spec"}: ${issue.message}`);
    }
  }
  if (issues.length === 0) {
    const structural = mod.validateSpec(spec);
    for (const issue of structural.issues) {
      if (issue.severity !== "warning") issues.push(issue.message);
    }
  }
  return issues;
}

/** The catalog's own LLM description of every page component and its props. */
export async function pageCatalogGuide(): Promise<string> {
  const mod = await pageCatalog();
  return mod.catalog.prompt();
}
