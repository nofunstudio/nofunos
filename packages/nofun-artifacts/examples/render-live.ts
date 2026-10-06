// Proof run for the live compiler: three json-render landing pages (one per brand, page lane) and the
// live-blocks.tsx dashboard (tsx lane), written to examples/out and screenshotted at 1440 and 390.
// The 1440 x 2250 "top" shot matches nofun-components' own json-render reference sheet
// (.ref/w9/jsonrender/shots/<id>.jpg) for a side-by-side check.
//   node examples/render-live.ts [path to Chrome]
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import { compileArtifact, compilePage, componentsDir } from "../src/compiler.ts";
import { closeProbe } from "../src/live/probe.ts";

const HERE = NodePath.dirname(fileURLToPath(import.meta.url));
const OUT = NodePath.join(HERE, "out");
const CHROME = process.argv[2] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SPECS = [
  { id: "hoopla-l01", brand: "hoopla" },
  { id: "mesa-form-l03", brand: "mesa-form" },
  { id: "smudge-club-l05", brand: "smudge-club" },
];

await NodeFs.mkdir(OUT, { recursive: true });
const pages: { name: string; file: string }[] = [];
for (const { id, brand } of SPECS) {
  const spec = JSON.parse(
    await NodeFs.readFile(
      NodePath.join(componentsDir(), "experiments/json-render/specs", `${id}.json`),
      "utf8",
    ),
  );
  const compiled = await compilePage({ spec, brand, title: id });
  const file = NodePath.join(OUT, `page-${id}.html`);
  await NodeFs.writeFile(file, compiled.html);
  pages.push({ name: `page-${id}`, file });
  console.log(
    `page-${id}: ${(compiled.bytes / 1024 / 1024).toFixed(2)} MiB (images ${(compiled.assetBytes / 1024 / 1024).toFixed(2)} MiB) in ${compiled.compileMs} ms${compiled.warnings.length ? ` warnings: ${compiled.warnings.join(" | ")}` : ""}`,
  );
}
for (const theme of ["kobra", "mrch"]) {
  const compiled = await compileArtifact({
    tsx: await NodeFs.readFile(NodePath.join(HERE, "live-blocks.tsx"), "utf8"),
    theme,
    title: "Studio pulse (example data)",
  });
  const file = NodePath.join(OUT, `tsx-live-blocks-${theme}.html`);
  await NodeFs.writeFile(file, compiled.html);
  pages.push({ name: `tsx-live-blocks-${theme}`, file });
  console.log(
    `tsx-live-blocks-${theme}: ${(compiled.bytes / 1024 / 1024).toFixed(2)} MiB in ${compiled.compileMs} ms${compiled.warnings.length ? ` warnings: ${compiled.warnings.join(" | ")}` : ""}`,
  );
}
await closeProbe();

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const page of pages) {
    for (const width of [1440, 390]) {
      const tab = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      tab.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      tab.on("pageerror", (error) => errors.push(error.message));
      await tab.goto(`file://${page.file}`);
      await tab.waitForTimeout(1200);
      const height = await tab.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 700) {
        await tab.evaluate((top) => window.scrollTo(0, top), y);
        await tab.waitForTimeout(60);
      }
      await tab.evaluate(() => window.scrollTo(0, 0));
      // Grow the viewport to the page instead of a fullPage capture: resizing restarts Recharts' entry
      // animation, so give it time to finish before the shot.
      await tab.setViewportSize({ width, height: Math.min(height, 16_000) });
      await tab.waitForTimeout(900);
      await tab.screenshot({ path: NodePath.join(OUT, `${page.name}-${width}.png`) });
      if (width === 1440 && page.name.startsWith("page-")) {
        await tab.setViewportSize({ width: 1440, height: 2250 });
        await tab.waitForTimeout(300);
        await tab.screenshot({ path: NodePath.join(OUT, `${page.name}-top.png`) });
      }
      console.log(
        `${page.name} @${width}: ${height}px${errors.length ? ` errors: ${errors.slice(0, 3).join(" | ")}` : ""}`,
      );
      await tab.close();
    }
  }
} finally {
  await browser.close();
}
