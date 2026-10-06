/**
 * Start a T3 server for one No Fun persona.
 *
 *   node scripts/nofun/persona.ts start nofun|catches [--port N] [--dry-run] [-- <extra server args>]
 *   node scripts/nofun/persona.ts show nofun|catches
 *
 * Reads ~/.nofun-t3/personas.json (see scripts/nofun/personas.example.json),
 * gives the server its own --base-dir, seeds provider instances for that home
 * if settings.json does not define them yet, strips billing-override env var
 * names from the CHILD environment only, and hands the persona scope to the
 * server through T3CODE_PERSONA* variables. Paths only; no secrets are read.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface InstanceSpec {
  driver: "claudeAgent" | "codex";
  displayName?: string;
  homePath?: string;
}
interface PersonaSpec {
  label: string;
  accent?: string;
  /** Persona icon id shown by clients ("nofun" | "catches"); defaults to the persona id. */
  icon?: string;
  port?: number;
  homeDir: string;
  allowedProjectRoots?: string[];
  providerInstances?: Record<string, InstanceSpec>;
  browserProfiles?: string[];
}
interface PersonaFile {
  personas: Record<string, PersonaSpec>;
  browserProfileUrls?: Record<string, string>;
  billingOverrideEnvNames?: string[];
}

const DEFAULT_STRIPPED_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "META_API_KEY",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
];

const expand = (value: string): string =>
  value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const configPath = path.join(os.homedir(), ".nofun-t3", "personas.json");

function fail(message: string): never {
  console.error(`persona: ${message}`);
  process.exit(1);
}

function loadConfig(): PersonaFile {
  if (!fs.existsSync(configPath)) {
    fail(
      `missing ${configPath}. Copy scripts/nofun/personas.example.json there and edit paths (paths only, no secrets).`,
    );
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as PersonaFile;
}

/** Merge persona provider instances into <home>/userdata/settings.json without overwriting user edits. */
function seedSettings(homeDir: string, spec: PersonaSpec): void {
  const settingsPath = path.join(homeDir, "userdata", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings: Record<string, any> = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath, "utf8"))
    : {};
  const instances: Record<string, any> = (settings.providerInstances ??= {});
  const providers: Record<string, any> = (settings.providers ??= {});
  for (const [id, instance] of Object.entries(spec.providerInstances ?? {})) {
    if (instances[id] === undefined) {
      instances[id] = {
        driver: instance.driver,
        displayName: instance.displayName ?? id,
        config: instance.homePath ? { homePath: expand(instance.homePath) } : {},
      };
    }
    // An explicit instance for a driver replaces the legacy default, which
    // would otherwise point at whatever account lives in ~/.claude or ~/.codex.
    const legacyKey = instance.driver;
    providers[legacyKey] = { ...providers[legacyKey], enabled: false };
  }
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function start(personaId: string, args: string[]): void {
  const config = loadConfig();
  const spec = config.personas[personaId];
  if (spec === undefined) {
    fail(`unknown persona '${personaId}'. Known: ${Object.keys(config.personas).join(", ")}`);
  }
  const dryRun = args.includes("--dry-run");
  const portFlag = args.indexOf("--port");
  const port = portFlag >= 0 ? Number(args[portFlag + 1]) : (spec.port ?? 3790);
  const dashDash = args.indexOf("--");
  const extra = dashDash >= 0 ? args.slice(dashDash + 1) : [];
  const homeDir = path.resolve(expand(spec.homeDir));
  const roots = (spec.allowedProjectRoots ?? []).map((root) => path.resolve(expand(root)));

  const env: NodeJS.ProcessEnv = { ...process.env };
  const stripped: string[] = [];
  for (const name of config.billingOverrideEnvNames ?? DEFAULT_STRIPPED_ENV) {
    if (env[name] !== undefined) stripped.push(name);
    delete env[name];
  }
  env.T3CODE_PERSONA = personaId;
  env.T3CODE_PERSONA_LABEL = spec.label;
  if (spec.accent) env.T3CODE_PERSONA_ACCENT = spec.accent;
  if (spec.icon) env.T3CODE_PERSONA_ICON = spec.icon;
  env.T3CODE_PERSONA_ROOTS = roots.join(path.delimiter);

  const command = [
    "node",
    path.join(repoRoot, "apps/server/src/bin.ts"),
    "--base-dir",
    homeDir,
    "--port",
    String(port),
    "--no-browser",
    ...extra,
  ];
  console.log(`persona ${personaId} (${spec.label})`);
  console.log(`  home      ${homeDir}`);
  console.log(`  port      ${port}`);
  console.log(`  roots     ${roots.join(", ") || "(unrestricted)"}`);
  console.log(`  instances ${Object.keys(spec.providerInstances ?? {}).join(", ") || "(none)"}`);
  console.log(`  profiles  ${(spec.browserProfiles ?? []).join(", ") || "(none)"}`);
  console.log(`  stripped env names from child: ${stripped.join(", ") || "(none present)"}`);
  if (dryRun) {
    console.log(`  dry-run: ${command.join(" ")}`);
    return;
  }
  seedSettings(homeDir, spec);
  const child = spawn(command[0]!, command.slice(1), { env, stdio: "inherit" });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  child.on("exit", (code) => process.exit(code ?? 0));
}

const [verb, personaId, ...rest] = process.argv.slice(2);
if ((verb === "start" || verb === "show") && personaId) {
  start(personaId, verb === "show" ? [...rest, "--dry-run"] : rest);
} else {
  fail(
    "usage: node scripts/nofun/persona.ts start|show <persona> [--port N] [--dry-run] [-- args]",
  );
}
