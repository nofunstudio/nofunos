// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Host-side setup script, not server code.
// Installs a built Warp web bundle where the T3 server serves it from.
//   node scripts/nofun/install-warp-bundle.ts <path to nofun-embed-dist> [--home ~/.nofun-t3]
// The server looks for `<T3 home>/warp-embed` (after NOFUN_WARP_BUNDLE_DIR), so no restart is
// needed: press "Check again" in the Warp drawer. The previous install is kept as `warp-embed.prev`.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const { values, positionals } = NodeUtil.parseArgs({
  options: { home: { type: "string" } },
  allowPositionals: true,
});

const expand = (value: string) => value.replace(/^~(?=\/|$)/, NodeOS.homedir());
const source = positionals[0] ? NodePath.resolve(expand(positionals[0])) : null;
if (source === null) {
  throw new Error(
    "usage: node scripts/nofun/install-warp-bundle.ts <path to nofun-embed-dist> [--home <T3 home>]",
  );
}
if (!NodeFS.existsSync(NodePath.join(source, "index.html"))) {
  throw new Error(`${source} has no index.html: point this at a built nofun-embed-dist directory`);
}

const home = NodePath.resolve(expand(values.home ?? NodePath.join(NodeOS.homedir(), ".nofun-t3")));
const target = NodePath.join(home, "warp-embed");
const staging = `${target}.installing`;
const previous = `${target}.prev`;

NodeFS.mkdirSync(home, { recursive: true });
NodeFS.rmSync(staging, { recursive: true, force: true });
// COPYFILE_FICLONE makes the 150+ MB wasm a copy-on-write clone on APFS and a plain copy elsewhere.
NodeFS.cpSync(source, staging, {
  recursive: true,
  mode: NodeFS.constants.COPYFILE_FICLONE,
  verbatimSymlinks: false,
});
if (!NodeFS.existsSync(NodePath.join(staging, "index.html"))) {
  NodeFS.rmSync(staging, { recursive: true, force: true });
  throw new Error("copy failed: index.html missing from the staged bundle");
}
if (NodeFS.existsSync(target)) {
  NodeFS.rmSync(previous, { recursive: true, force: true });
  NodeFS.renameSync(target, previous);
}
NodeFS.renameSync(staging, target);

const manifestPath = NodePath.join(target, "nofun-embed.json");
const subpath = NodeFS.existsSync(manifestPath)
  ? (() => {
      try {
        return JSON.parse(NodeFS.readFileSync(manifestPath, "utf8")).subpath === true;
      } catch {
        return false;
      }
    })()
  : false;
console.log(`Installed the Warp bundle into ${target}`);
console.log(
  subpath
    ? "Serving: same-origin at /warp-embed/ (works over LAN, Tailscale and T3 Connect)."
    : "Serving: this bundle has no sub-path flag, so T3 falls back to a loopback listener (local only).",
);
