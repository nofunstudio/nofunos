// The No Fun artifact compiler: a fixed, root-owned toolchain (esbuild + Tailwind, both pinned in this
// package) that turns a catalog spec or bounded custom TSX into ONE self-contained HTML document.
//
// - The runtime (React, ReactDOM, the No Fun components) is bundled once per process and inlined into
//   every page. A spec is data the runtime renders; custom TSX recompiles only its own entry, with
//   `react` and `@nofun/artifacts` resolved to the runtime's shared instances.
// - Nothing generated here runs on the server: esbuild only parses and bundles the TSX, and the page
//   executes in T3's sandboxed HTML render frame. No network, no package installs, no other imports.
import * as NodeFs from "node:fs/promises";
import { createRequire } from "node:module";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import { compile as compileTailwind } from "tailwindcss";

import { validateArtifactSpec, type ArtifactSpec } from "./catalog.ts";
import {
  ARTIFACT_THEMES,
  DEFAULT_ARTIFACT_THEME,
  isArtifactThemeId,
  type ArtifactThemeId,
} from "./themes.ts";

export {
  ArtifactSpecError,
  artifactCatalogGuide,
  ARTIFACT_COMPONENT_NAMES,
  type ArtifactSpec,
} from "./catalog.ts";
export {
  ARTIFACT_THEME_IDS,
  ARTIFACT_THEMES,
  artifactThemeGuide,
  type ArtifactThemeId,
} from "./themes.ts";

const SRC_DIR = NodePath.dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = NodePath.join(SRC_DIR, "styles");
const RUNTIME_ENTRY = NodePath.join(SRC_DIR, "runtime", "entry.tsx");
const require = createRequire(import.meta.url);
const TAILWIND_DIR = NodePath.dirname(require.resolve("tailwindcss/package.json"));

/** Custom TSX may import only these. */
export const ARTIFACT_ALLOWED_IMPORTS = ["react", "react/jsx-runtime", "@nofun/artifacts"] as const;

const MAX_TSX_CHARS = 100_000;
/** Practical budget for one artifact page, well under HtmlRender's 25 MiB cap. */
export const ARTIFACT_MAX_PAGE_BYTES = 2 * 1024 * 1024;
const JS_TARGET = ["es2022", "chrome111", "safari16.4", "firefox115"];
// Safari 16.4 lacks CSS nesting, so esbuild flattens Tailwind's nested output.
const CSS_TARGET = ["chrome111", "safari16.4", "firefox115"];

// Tailwind's own stylesheet comes first; then the No Fun snapshots in the order the registry loads them.
const STYLE_FILES = ["kobra-theme.css", "nofun-base.css", "kobra-surface.css", "artifact.css"];

export class ArtifactCompileError extends Error {
  readonly issues: ReadonlyArray<string>;
  constructor(message: string, issues: ReadonlyArray<string> = []) {
    super(issues.length === 0 ? message : `${message}\n- ${issues.slice(0, 20).join("\n- ")}`);
    this.issues = issues;
  }
}

export interface ArtifactCompileInput {
  /** A catalog spec: `{ root: { component, props, children } }`, optionally with theme and title. */
  readonly spec?: unknown;
  /** Custom React TSX with a default-exported component. */
  readonly tsx?: string | undefined;
  readonly theme?: string | undefined;
  readonly title?: string | undefined;
}

export interface CompiledArtifact {
  readonly html: string;
  readonly title: string;
  readonly theme: ArtifactThemeId;
  readonly lane: "spec" | "tsx";
  readonly bytes: number;
  readonly compileMs: number;
}

interface Runtime {
  readonly js: string;
  /** Class-name candidates scanned from the runtime's own sources. */
  readonly candidates: ReadonlyArray<string>;
}

const escapeScript = (text: string) => text.replace(/<\/(script)/gi, "<\\/$1");
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );

/** Tokens that might be Tailwind classes. Tailwind ignores the ones that are not. */
function candidatesOf(source: string): string[] {
  return source.split(/[\s"'`]+/).filter((token) => token.length > 0 && token.length < 300);
}

let runtimePromise: Promise<Runtime> | undefined;

function buildRuntime(): Promise<Runtime> {
  runtimePromise ??= (async () => {
    const result = await esbuild.build({
      entryPoints: [RUNTIME_ENTRY],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: JS_TARGET,
      minify: true,
      jsx: "automatic",
      legalComments: "none",
      metafile: true,
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const js = result.outputFiles[0]?.text ?? "";
    const sources = Object.keys(result.metafile.inputs)
      .map((input) => NodePath.resolve(process.cwd(), input))
      .filter((file) => file.startsWith(SRC_DIR));
    const candidates = new Set<string>();
    for (const file of sources) {
      for (const token of candidatesOf(await NodeFs.readFile(file, "utf8"))) candidates.add(token);
    }
    return { js, candidates: [...candidates] };
  })().catch((error: unknown) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

let stylesInput: Promise<string> | undefined;

function readStyles() {
  stylesInput ??= Promise.all(
    STYLE_FILES.map((file) => NodeFs.readFile(NodePath.join(STYLES_DIR, file), "utf8")),
  ).then((files) => `@import "tailwindcss";\n${files.join("\n")}`);
  return stylesInput;
}

/** Tailwind's compiler accumulates candidates across builds, so each page gets a fresh one. */
async function tailwindCss(candidates: Iterable<string>) {
  const compiler = await compileTailwind(await readStyles(), {
    base: STYLES_DIR,
    loadStylesheet: async (id, base) => {
      const file =
        id === "tailwindcss"
          ? NodePath.join(TAILWIND_DIR, "index.css")
          : NodePath.resolve(base, id.endsWith(".css") ? id : `${id}.css`);
      if (!file.startsWith(TAILWIND_DIR)) {
        throw new ArtifactCompileError(
          `Stylesheet import "${id}" is outside the artifact toolchain.`,
        );
      }
      return {
        path: file,
        base: NodePath.dirname(file),
        content: await NodeFs.readFile(file, "utf8"),
      };
    },
  });
  const css = compiler.build([...candidates]);
  const minified = await esbuild.transform(css, {
    loader: "css",
    minify: true,
    target: CSS_TARGET,
    logLevel: "silent",
  });
  return minified.code;
}

let specCss: Promise<string> | undefined;

async function cssFor(theme: ArtifactThemeId, extraCandidates?: ReadonlyArray<string>) {
  const runtime = await buildRuntime();
  const base =
    extraCandidates === undefined
      ? await (specCss ??= tailwindCss(runtime.candidates).catch((error: unknown) => {
          specCss = undefined;
          throw error;
        }))
      : await tailwindCss([...runtime.candidates, ...extraCandidates]);
  const file = ARTIFACT_THEMES[theme].file;
  const themeCss =
    file === null ? "" : await NodeFs.readFile(NodePath.join(STYLES_DIR, "themes", file), "utf8");
  if (themeCss === "") return base;
  const minified = await esbuild.transform(themeCss, {
    loader: "css",
    minify: true,
    target: CSS_TARGET,
    logLevel: "silent",
  });
  return base + minified.code;
}

// Follows T3's light/dark: T3's bootstrap sets `color-scheme` on :root (and rewrites it live), and No Fun
// keys its dark tokens off a `.dark` class. The class goes on <body>, next to the brand scope, so the
// registry's `.dark` defaults never shadow the variables T3 injects on :root. Runs first in <body>, so
// the first paint is already right.
const MODE_SCRIPT = `(function(){var d=document.documentElement,b=document.body;function m(){var c=getComputedStyle(d).colorScheme||"";b.classList.toggle("dark",/dark/.test(c)&&!/light/.test(c))}m();var s=document.getElementById("t3-theme");if(s&&window.MutationObserver)new MutationObserver(m).observe(s,{childList:true,characterData:true,subtree:true});if(window.matchMedia)matchMedia("(prefers-color-scheme: dark)").addEventListener("change",m)})();`;

function documentFor(input: {
  readonly title: string;
  readonly theme: ArtifactThemeId;
  readonly css: string;
  readonly runtime: string;
  readonly body: string;
}) {
  // The brand scope sits on <body>, like a [data-brand] section in nofun-components: the registry's
  // :root and .dark defaults stay on <html> and the brand sheet overrides them below it.
  const brand = input.theme === "t3" ? "" : ` data-brand="${input.theme}"`;
  return [
    `<!doctype html><html lang="en"><head>`,
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(input.title)}</title>`,
    `<style id="nf-style">${input.css}</style>`,
    `</head><body data-nf-theme="${input.theme}"${brand}><script>${MODE_SCRIPT}</script><div id="nf-root"></div>`,
    `<script>${escapeScript(input.runtime)}</script>`,
    input.body,
    `</body></html>`,
  ].join("");
}

function formatEsbuildMessages(messages: ReadonlyArray<esbuild.Message>) {
  return messages.map((message) => {
    const at = message.location;
    const where = at ? `artifact.tsx:${at.line}:${at.column + 1}: ` : "";
    const line = at?.lineText ? ` (\`${at.lineText.trim().slice(0, 120)}\`)` : "";
    return `${where}${message.text}${line}`;
  });
}

async function compileTsx(tsx: string) {
  const rejected: string[] = [];
  const result = await esbuild
    .build({
      stdin: {
        contents: 'import App from "nf:user";\nwindow.__NF.mountApp(App);\n',
        loader: "js",
        sourcefile: "entry.js",
        resolveDir: SRC_DIR,
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: JS_TARGET,
      minify: true,
      jsx: "automatic",
      legalComments: "none",
      logLevel: "silent",
      // Keep unused imports, so every import the TSX names goes through the allowlist.
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "nofun-artifact-imports",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (args.path === "nf:user") return { path: "artifact.tsx", namespace: "nf-user" };
              if ((ARTIFACT_ALLOWED_IMPORTS as ReadonlyArray<string>).includes(args.path)) {
                return { path: args.path, namespace: "nf-shim" };
              }
              rejected.push(args.path);
              return {
                errors: [
                  {
                    text: `Import "${args.path}" is not allowed. Custom artifacts may import only "react" and "@nofun/artifacts"; inline anything else.`,
                  },
                ],
              };
            });
            build.onLoad({ filter: /.*/, namespace: "nf-user" }, () => ({
              contents: tsx,
              loader: "tsx",
            }));
            build.onLoad({ filter: /.*/, namespace: "nf-shim" }, (args) => ({
              contents:
                args.path === "react"
                  ? "module.exports = window.__NF.React;"
                  : args.path === "react/jsx-runtime"
                    ? "module.exports = window.__NF.jsxRuntime;"
                    : "module.exports = window.__NF.lib;",
              loader: "js",
            }));
          },
        },
      ],
    })
    .catch((error: unknown) => {
      const failure = error as { errors?: ReadonlyArray<esbuild.Message> };
      const issues = formatEsbuildMessages(failure.errors ?? []);
      const noDefault = issues.some((issue) => issue.includes('for import "default"'));
      throw new ArtifactCompileError(
        noDefault
          ? "The custom TSX must `export default` a React component."
          : rejected.length > 0
            ? "The custom TSX imports a module artifacts cannot use."
            : "The custom TSX did not compile.",
        issues,
      );
    });
  return result.outputFiles[0]?.text ?? "";
}

/** Compiles one artifact to a self-contained HTML document. Throws ArtifactSpecError or ArtifactCompileError. */
export async function compileArtifact(input: ArtifactCompileInput): Promise<CompiledArtifact> {
  const started = performance.now();
  const hasSpec = input.spec !== undefined && input.spec !== null;
  const hasTsx = typeof input.tsx === "string" && input.tsx.trim() !== "";
  if (hasSpec === hasTsx) {
    throw new ArtifactCompileError(
      "Pass exactly one of `spec` (a catalog spec) or `tsx` (custom React).",
    );
  }
  let spec: ArtifactSpec | undefined;
  if (hasSpec) {
    const raw = typeof input.spec === "string" ? parseSpecString(input.spec) : input.spec;
    spec = validateArtifactSpec(raw);
  }
  const requestedTheme = input.theme ?? spec?.theme ?? DEFAULT_ARTIFACT_THEME;
  if (!isArtifactThemeId(requestedTheme)) {
    throw new ArtifactCompileError(
      `Unknown theme "${requestedTheme}". Use one of ${Object.keys(ARTIFACT_THEMES).join(", ")}.`,
    );
  }
  const theme = requestedTheme;
  const title =
    (input.title ?? spec?.title ?? "No Fun artifact").trim().slice(0, 200) || "No Fun artifact";
  const runtime = await buildRuntime();

  let body: string;
  let css: string;
  if (spec) {
    css = await cssFor(theme);
    const data = JSON.stringify({ root: spec.root }).replace(/</g, "\\u003c");
    body = `<script type="application/json" id="nf-spec">${data}</script><script>window.__NF.mountSpec();</script>`;
  } else {
    const tsx = input.tsx!;
    if (tsx.length > MAX_TSX_CHARS) {
      throw new ArtifactCompileError(
        `Custom TSX is ${tsx.length} characters; the limit is ${MAX_TSX_CHARS}.`,
      );
    }
    const [entry, pageCss] = await Promise.all([compileTsx(tsx), cssFor(theme, candidatesOf(tsx))]);
    css = pageCss;
    body = `<script>${escapeScript(entry)}</script>`;
  }

  const html = documentFor({ title, theme, css, runtime: runtime.js, body });
  const bytes = Buffer.byteLength(html);
  if (bytes > ARTIFACT_MAX_PAGE_BYTES) {
    throw new ArtifactCompileError(
      `The artifact is ${(bytes / 1024 / 1024).toFixed(1)} MiB; keep it under ${ARTIFACT_MAX_PAGE_BYTES / 1024 / 1024} MiB (trim rows or data URIs).`,
    );
  }
  return {
    html,
    title,
    theme,
    lane: spec ? "spec" : "tsx",
    bytes,
    compileMs: Math.round(performance.now() - started),
  };
}

function parseSpecString(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ArtifactCompileError(`The spec is not valid JSON: ${(error as Error).message}`);
  }
}

/** Builds the shared runtime and spec stylesheet ahead of the first artifact. */
export async function warmArtifactCompiler() {
  await cssFor(DEFAULT_ARTIFACT_THEME);
}
