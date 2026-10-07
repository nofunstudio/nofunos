// @effect-diagnostics nodeBuiltinImport:off -- Fixture directories for a filesystem-backed resolver.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_WARP_BUNDLE_DIR,
  makeWarpBundleServer,
  resolveWarpBundleDir,
  WARP_INSTALL_COMMAND,
} from "./bundle.ts";

const roots: string[] = [];
const tmp = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "warp-bundle-"));
  roots.push(dir);
  return dir;
};
const install = (home: string, manifest?: object) => {
  const dir = NodePath.join(home, "warp-embed");
  NodeFS.mkdirSync(dir, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(dir, "index.html"), "<html></html>");
  if (manifest)
    NodeFS.writeFileSync(NodePath.join(dir, "nofun-embed.json"), JSON.stringify(manifest));
  return dir;
};

afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("warp bundle location", () => {
  it("prefers NOFUN_WARP_BUNDLE_DIR, then <T3 home>/warp-embed, then the dev worktree", async () => {
    const home = tmp();
    expect(await resolveWarpBundleDir(home, {})).toBe(DEFAULT_WARP_BUNDLE_DIR);
    const installed = install(home);
    expect(await resolveWarpBundleDir(home, {})).toBe(installed);
    expect(await resolveWarpBundleDir(home, { NOFUN_WARP_BUNDLE_DIR: "/explicit" })).toBe(
      "/explicit",
    );
  });

  it("names the install command when no bundle exists, and finds a bundle installed later", async () => {
    const home = tmp();
    const server = makeWarpBundleServer(home, {
      NOFUN_WARP_BUNDLE_DIR: NodePath.join(home, "nope"),
    });
    const missing = await server.status();
    expect(missing.state).toBe("missing");
    expect(missing.state === "missing" ? missing.message : "").toContain(WARP_INSTALL_COMMAND);

    const later = makeWarpBundleServer(home, {});
    install(home, { subpath: true });
    expect(await later.status()).toEqual({ state: "ready", mode: "same-origin", origin: null });
    await later.stop();
  });
});

describe("warp bundle serving mode", () => {
  it("serves same-origin only when the bundle declares sub-path support, unless overridden", async () => {
    const home = tmp();
    install(home, { subpath: false });
    const loopback = makeWarpBundleServer(home, {});
    const status = await loopback.status();
    expect(status).toMatchObject({ state: "ready", mode: "loopback" });
    expect(status.state === "ready" ? status.origin : "").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await loopback.stop();

    const forced = makeWarpBundleServer(home, { NOFUN_WARP_SERVING: "same-origin" });
    expect(await forced.status()).toMatchObject({ mode: "same-origin" });
    await forced.stop();
  });

  it("only resolves files inside the bundle", async () => {
    const home = tmp();
    const dir = install(home, { subpath: true });
    NodeFS.writeFileSync(NodePath.join(home, "secret.txt"), "x");
    const server = makeWarpBundleServer(home, {});
    await server.status();
    expect(await server.resolveFile("")).toBe(NodePath.join(dir, "index.html"));
    expect(await server.resolveFile("../secret.txt")).toBeNull();
    expect(await server.resolveFile("missing.js")).toBeNull();
    await server.stop();
  });
});
