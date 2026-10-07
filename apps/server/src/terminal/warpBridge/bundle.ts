// @effect-diagnostics nodeBuiltinImport:off -- A plain node:http static listener: the guest needs an origin root that T3's own HTTP router cannot give it.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";

/**
 * Where the built Warp web guest lives. The guest imports its wasm from absolute
 * `/assets/...` paths, so it must be served from an origin root; T3's own origin
 * already owns `/assets`. The bundle is therefore served by a second loopback
 * listener, which also keeps the guest's origin separate from the T3 app.
 */
export const DEFAULT_WARP_BUNDLE_DIR =
  "/Users/nofun/Documents/GitHub/.wt/warp-nofunos-terminal/nofun-embed-dist";

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
  | { readonly state: "ready"; readonly origin: string }
  | { readonly state: "missing"; readonly dir: string; readonly message: string };

export interface WarpBundleServer {
  readonly status: () => Promise<WarpBundleStatus>;
  readonly stop: () => Promise<void>;
}

const isFile = async (path: string) => {
  try {
    return (await NodeFSP.stat(path)).isFile();
  } catch {
    return false;
  }
};

export function resolveWarpBundleDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.NOFUN_WARP_BUNDLE_DIR?.trim() || DEFAULT_WARP_BUNDLE_DIR;
}

export function makeWarpBundleServer(dir: string): WarpBundleServer {
  let started: Promise<WarpBundleStatus> | null = null;
  let server: NodeHttp.Server | null = null;

  const start = async (): Promise<WarpBundleStatus> => {
    if (!(await isFile(NodePath.join(dir, "index.html")))) {
      return {
        state: "missing",
        dir,
        message:
          `The Warp web bundle was not found at ${dir}. Build it (nofun-embed/package.sh in the Warp ` +
          "worktree) or point NOFUN_WARP_BUNDLE_DIR at its nofun-embed-dist directory, then reopen the terminal.",
      };
    }
    const root = NodePath.normalize(dir);
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
    return { state: "ready", origin: `http://127.0.0.1:${port}` };
  };

  return {
    status: () => {
      started ??= start().then((status) => {
        // A missing bundle is rechecked on the next call so building it needs no server restart.
        if (status.state === "missing") started = null;
        return status;
      });
      return started;
    },
    stop: async () => {
      const current = server;
      server = null;
      started = null;
      if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
    },
  };
}
