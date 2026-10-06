// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Host-side one-shot script, not server code.
/**
 * Copy the No Fun T3 dev app's data into the packaged app's home, once.
 *
 *   node scripts/nofun/migrate-from-dev.ts [--dry-run] [--source <dir>] [--target <dir>] [--dev-port <n>]
 *
 * Source defaults to ~/.nofun-t3-proto/userdata (the dev app's --home-dir), target to
 * ~/.nofun-t3/userdata (the packaged app's default home). It COPIES, never moves or deletes:
 * statev2.sqlite through SQLite's online backup API (so WAL content is included and the copy is
 * consistent), plus secrets/, settings.json and attachments/.
 *
 * It refuses when the dev app looks alive (something listening on the dev server port, or any
 * process holding the source database open) and when the target already has anything in it, so
 * a second run, or a run after the packaged app has started once, cannot clobber data.
 * File names are printed; file contents (including secrets) never are.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

/** The dev desktop app's server port (see ~/.nofun-t3/launch.sh). */
const DEFAULT_DEV_PORT = "13773";
const DATABASE = "statev2.sqlite";
const COPIED_ENTRIES = ["secrets", "settings.json", "attachments"] as const;

const expand = (value: string): string =>
  value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`migrate-from-dev: ${message}`);
  process.exit(1);
}

/** lsof exits 1 when nothing matches, which execFileSync reports as a throw. */
function lsof(args: ReadonlyArray<string>): string {
  try {
    return execFileSync("lsof", [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

const dryRun = process.argv.includes("--dry-run");
const source = path.resolve(expand(flag("--source") ?? "~/.nofun-t3-proto/userdata"));
const target = path.resolve(expand(flag("--target") ?? "~/.nofun-t3/userdata"));
const sourceDatabase = path.join(source, DATABASE);

if (source === target) fail("source and target are the same directory.");
if (!fs.existsSync(sourceDatabase)) fail(`no ${DATABASE} in ${source}.`);

const devPort = flag("--dev-port") ?? DEFAULT_DEV_PORT;
if (!/^\d+$/.test(devPort)) fail(`--dev-port must be a number, got ${devPort}.`);
if (lsof(["-nP", `-iTCP:${devPort}`, "-sTCP:LISTEN"]).trim()) {
  fail(`something is listening on dev port ${devPort}. Quit the dev app first.`);
}
const holders = [DATABASE, `${DATABASE}-wal`]
  .map((name) => path.join(source, name))
  .filter((file) => fs.existsSync(file))
  .map((file) => lsof(["-t", file]).trim())
  .filter(Boolean);
if (holders.length > 0) {
  fail(`the source database is open in process(es) ${holders.join(", ")}. Quit the dev app first.`);
}

if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
  fail(`${target} is not empty. Refusing to overwrite the packaged app's data.`);
}

const plan = [
  DATABASE,
  ...COPIED_ENTRIES.filter((entry) => fs.existsSync(path.join(source, entry))),
];
console.log(`${dryRun ? "would copy" : "copying"} ${source} -> ${target}: ${plan.join(", ")}`);
if (dryRun) process.exit(0);

fs.mkdirSync(target, { recursive: true, mode: 0o700 });

// The backup API reads a consistent snapshot, folding in anything still in the WAL.
const database = new DatabaseSync(sourceDatabase, { readOnly: true });
try {
  await backup(database, path.join(target, DATABASE));
} finally {
  database.close();
}

for (const entry of COPIED_ENTRIES) {
  const from = path.join(source, entry);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(target, entry), {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: true,
    force: false,
  });
}
// Secrets keep owner-only permissions even if the source was looser.
const secretsDir = path.join(target, "secrets");
if (fs.existsSync(secretsDir)) {
  fs.chmodSync(secretsDir, 0o700);
  for (const name of fs.readdirSync(secretsDir)) fs.chmodSync(path.join(secretsDir, name), 0o600);
}

const check = new DatabaseSync(path.join(target, DATABASE), { readOnly: true });
const integrity = check.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
const threads = (() => {
  try {
    return (
      check.prepare("SELECT count(*) AS n FROM orchestration_v2_projection_threads").get() as {
        n: number;
      }
    ).n;
  } catch {
    return undefined;
  }
})();
check.close();
if (integrity?.quick_check !== "ok")
  fail(`copied database failed quick_check: ${integrity?.quick_check}`);
console.log(
  `migrated: ${plan.join(", ")}${threads === undefined ? "" : ` (${threads} threads)`}. Source left untouched.`,
);
