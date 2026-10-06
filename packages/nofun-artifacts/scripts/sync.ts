// Resync with the live nofun-components checkout: writes generated/index.json (the component index
// agents search) and generated/compile-report.json (which indexed components compile in isolation;
// search leaves failures out). `--render` also renders each component's demo headless and records
// runtime errors. Never edits the checkout.
//   vp run --filter @t3tools/nofun-artifacts sync [-- --render] [--only name,name]
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { compileArtifact } from "../src/compiler.ts";
import { bundle } from "../src/live/bundle.ts";
import { closeProbe } from "../src/live/probe.ts";
import { liveIndex, type IndexEntry } from "../src/live/registry.ts";
import {
  COMPILE_REPORT_FILE,
  GENERATED_DIR,
  INDEX_FILE,
  type CompileReport,
} from "../src/live/report.ts";
import { assertComponentsDir } from "../src/live/source.ts";

const args = process.argv.slice(2);
const render = args.includes("--render");
const onlyArg = args[args.indexOf("--only") + 1];
const only = args.includes("--only") && onlyArg ? new Set(onlyArg.split(",")) : undefined;
const CONCURRENCY = render ? 3 : 8;

const dir = assertComponentsDir();
const index = await liveIndex();
NodeFs.mkdirSync(GENERATED_DIR, { recursive: true });
NodeFs.writeFileSync(
  INDEX_FILE,
  `${JSON.stringify({ source: index.stamp, dir, entries: index.entries }, null, 1)}\n`,
);
console.log(
  `index: ${index.entries.length} items (${index.brands.length} brands) from ${dir} @ ${index.stamp}`,
);

const targets = index.entries.filter(
  (entry) =>
    (entry.kind === "block" || entry.kind === "component") && (!only || only.has(entry.name)),
);
const failures: { name: string; stage: "compile" | "render"; reason: string }[] = [];
let compiled = 0;
let rendered = 0;
const timings: { name: string; ms: number; bytes?: number }[] = [];

const firstLine = (text: string) =>
  text.split("\n").find((line) => line.trim() && !line.startsWith("The ")) ?? text.split("\n")[0]!;

async function check(entry: IndexEntry) {
  const started = performance.now();
  const entrySource = entry.demo
    ? `import { ${entry.demo.export} as Demo } from "${entry.demo.import}";\nimport * as M from "${entry.import}";\n(window as any).__nf = [Demo, M];`
    : `import * as M from "${entry.import}";\n(window as any).__nf = M;`;
  try {
    await bundle(dir, index, { entry: entrySource, minify: false });
    compiled += 1;
  } catch (error) {
    const issues = (error as { issues?: string[] }).issues;
    failures.push({
      name: entry.name,
      stage: "compile",
      reason: (issues?.[0] ?? (error as Error).message).slice(0, 300),
    });
    return;
  }
  if (!render || !entry.demo) {
    timings.push({ name: entry.name, ms: Math.round(performance.now() - started) });
    return;
  }
  try {
    const result = await compileArtifact({
      tsx: `import { ${entry.demo.export} as Demo } from "${entry.demo.import}";\nexport default function App() { return <Demo brand="kobra" />; }`,
      theme: "kobra",
      title: entry.title,
    });
    const fatal = result.warnings.filter((w) =>
      /Artifact render failed|Uncaught|is not defined|Cannot read|is not a function|Minified React error/i.test(
        w,
      ),
    );
    if (fatal.length > 0) {
      failures.push({ name: entry.name, stage: "render", reason: fatal[0]!.slice(0, 300) });
    } else {
      rendered += 1;
    }
    timings.push({
      name: entry.name,
      ms: Math.round(performance.now() - started),
      bytes: result.bytes,
    });
  } catch (error) {
    failures.push({
      name: entry.name,
      stage: "render",
      reason: firstLine((error as Error).message).slice(0, 300),
    });
  }
}

let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < targets.length) {
      const entry = targets[next++]!;
      await check(entry);
      process.stdout.write(".");
    }
  }),
);
process.stdout.write("\n");
await closeProbe();

const report: CompileReport = {
  source: index.stamp,
  generatedAt: new Date().toISOString(),
  total: targets.length,
  compiled,
  ...(render ? { rendered } : {}),
  failures: failures.sort((a, b) => a.name.localeCompare(b.name)),
};
if (!only) NodeFs.writeFileSync(COMPILE_REPORT_FILE, `${JSON.stringify(report, null, 1)}\n`);
NodeFs.writeFileSync(
  NodePath.join(GENERATED_DIR, "timings.json"),
  `${JSON.stringify(timings, null, 1)}\n`,
);
console.log(
  `compiled ${compiled}/${targets.length}${render ? `, rendered ${rendered}/${targets.filter((t) => t.demo).length} demos` : ""}`,
);
for (const failure of report.failures)
  console.log(`  ${failure.stage} ${failure.name}: ${failure.reason}`);
