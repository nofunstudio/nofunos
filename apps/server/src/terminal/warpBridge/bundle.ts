// @effect-diagnostics nodeBuiltinImport:off -- A plain node:http static listener: the guest needs an origin root that T3's own HTTP router cannot give it.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";

/**
 * Where the built Warp web guest lives and how it is served.
 *
 * Preferred: T3 itself serves the bundle at `/warp-embed/` on its own origin, so
 * the iframe and the attach socket are same-origin and work over LAN, Tailscale
 * and T3 Connect like the rest of the web app. That needs a bundle whose assets
 * resolve under a sub-path; a bundle says so with `nofun-embed.json`
 * (`{"subpath": true}`). A bundle without that flag imports its wasm from
 * absolute `/assets/...` paths (wave 1), which T3's own origin already owns, so
 * it falls back to a second loopback listener and a loopback-only attach socket.
 * `NOFUN_WARP_SERVING=loopback|same-origin` overrides the manifest.
 */
export const DEFAULT_WARP_BUNDLE_DIR =
  "/Users/nofun/Documents/GitHub/.wt/warp-nofunos-terminal/nofun-embed-dist";
export const WARP_EMBED_PATH_PREFIX = "/warp-embed";
export const WARP_BUNDLE_MANIFEST = "nofun-embed.json";
/** The command the drawer's missing-bundle message points at. */
export const WARP_INSTALL_COMMAND =
  "node scripts/nofun/install-warp-bundle.ts <path to nofun-embed-dist>";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
};

export type WarpBundleStatus =
  | {
      readonly state: "ready";
      /** `same-origin`: T3 serves `/warp-embed/` itself. `loopback`: a second listener at `origin`. */
      readonly mode: "same-origin" | "loopback";
      /** The bundle's own origin in loopback mode; null when it shares T3's origin. */
      readonly origin: string | null;
    }
  | { readonly state: "missing"; readonly dir: string; readonly message: string };

export interface WarpBundleServer {
  readonly status: () => Promise<WarpBundleStatus>;
  /** Absolute path of a bundle file for a `/warp-embed/...` request path, or null when outside the bundle. */
  readonly resolveFile: (relativePath: string) => Promise<string | null>;
  readonly stop: () => Promise<void>;
}

export const warpContentType = (path: string): string =>
  CONTENT_TYPES[NodePath.extname(path).toLowerCase()] ?? "application/octet-stream";

const isFile = async (path: string) => {
  try {
    return (await NodeFSP.stat(path)).isFile();
  } catch {
    return false;
  }
};

/**
 * Bundle directory, in order: `NOFUN_WARP_BUNDLE_DIR`, `<T3 home>/warp-embed`
 * (what `scripts/nofun/install-warp-bundle.ts` fills), then the dev worktree
 * build. Each is rechecked per call, so installing a bundle needs no restart.
 */
export async function resolveWarpBundleDir(
  baseDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const explicit = env.NOFUN_WARP_BUNDLE_DIR?.trim();
  if (explicit) return explicit;
  const installed = NodePath.join(baseDir, "warp-embed");
  if (await isFile(NodePath.join(installed, "index.html"))) return installed;
  return DEFAULT_WARP_BUNDLE_DIR;
}

const missingMessage = (dir: string, baseDir: string) =>
  `The Warp web bundle was not found at ${dir}. Install a built bundle into ` +
  `${NodePath.join(baseDir, "warp-embed")} with \`${WARP_INSTALL_COMMAND}\`, or point ` +
  "NOFUN_WARP_BUNDLE_DIR at a nofun-embed-dist directory, then press Check again.";

async function servesFromSubpath(dir: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const forced = env.NOFUN_WARP_SERVING?.trim();
  if (forced === "same-origin") return true;
  if (forced === "loopback") return false;
  try {
    const manifest: unknown = JSON.parse(
      await NodeFSP.readFile(NodePath.join(dir, WARP_BUNDLE_MANIFEST), "utf8"),
    );
    return (
      typeof manifest === "object" &&
      manifest !== null &&
      (manifest as Record<string, unknown>).subpath === true
    );
  } catch {
    return false;
  }
}

export function makeWarpBundleServer(
  baseDir: string,
  env: NodeJS.ProcessEnv = process.env,
): WarpBundleServer {
  let started: Promise<WarpBundleStatus> | null = null;
  let server: NodeHttp.Server | null = null;
  let currentRoot: string | null = null;

  const resolveFile = async (relativePath: string): Promise<string | null> => {
    const root = currentRoot ?? NodePath.normalize(await resolveWarpBundleDir(baseDir, env));
    const target = NodePath.normalize(
      NodePath.join(
        root,
        relativePath === "" || relativePath === "/" ? "index.html" : relativePath,
      ),
    );
    if (target !== root && !target.startsWith(root + NodePath.sep)) return null;
    return (await isFile(target)) ? target : null;
  };

  const start = async (): Promise<WarpBundleStatus> => {
    const dir = await resolveWarpBundleDir(baseDir, env);
    if (!(await isFile(NodePath.join(dir, "index.html")))) {
      return { state: "missing", dir, message: missingMessage(dir, baseDir) };
    }
    const root = NodePath.normalize(dir);
    currentRoot = root;
    if (await servesFromSubpath(dir, env)) {
      return { state: "ready", mode: "same-origin", origin: null };
    }
    const listener = NodeHttp.createServer((request, response) => {
      void (async () => {
        try {
          if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405).end();
            return;
          }
          const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
          const target = NodePath.normalize(
            NodePath.join(root, pathname === "/" ? "index.html" : pathname),
          );
          if (target !== root && !target.startsWith(root + NodePath.sep)) {
            response.writeHead(403).end();
            return;
          }
          const info = await NodeFSP.stat(target).catch(() => null);
          if (info === null || !info.isFile()) {
            response.writeHead(404).end();
            return;
          }
          const etag = `W/"${info.size}-${Math.floor(info.mtimeMs)}"`;
          if (request.headers["if-none-match"] === etag) {
            response.writeHead(304).end();
            return;
          }
          response.writeHead(200, {
            "Content-Type":
              CONTENT_TYPES[NodePath.extname(target).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": info.size,
            // Revalidate so a rebuilt bundle is picked up, without re-downloading unchanged files.
            "Cache-Control": "no-cache",
            ETag: etag,
            "X-Content-Type-Options": "nosniff",
          });
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          NodeFS.createReadStream(target)
            .on("error", () => response.destroy())
            .pipe(response);
        } catch {
          if (!response.headersSent) response.writeHead(400);
          response.end();
        }
      })();
    });
    server = listener;
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = listener.address() as NodeNet.AddressInfo;
    return { state: "ready", mode: "loopback", origin: `http://127.0.0.1:${port}` };
  };

  return {
    resolveFile,
    status: () => {
      started ??= start().then((status) => {
        // A missing bundle is rechecked on the next call so building it needs no server restart.
        if (status.state === "missing") {
          started = null;
          currentRoot = null;
        }
        return status;
      });
      return started;
    },
    stop: async () => {
      const current = server;
      server = null;
      started = null;
      currentRoot = null;
      if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
    },
  };
}
