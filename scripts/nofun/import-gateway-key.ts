// Copies the Vercel AI Gateway key into a No Fun T3 home's secret store, never printing it.
//   node scripts/nofun/import-gateway-key.ts --home ~/.nofun-t3/nofun [--from /path/to/.env]
// Without --from, the key is read from stdin (paste, then Ctrl-D).
import * as FS from "node:fs";
import * as Path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { home: { type: "string" }, from: { type: "string" } } });
if (!values.home) throw new Error("--home <T3 home dir> is required");
const home = values.home.replace(/^~(?=\/)/, process.env.HOME ?? "~");

const raw = values.from ? FS.readFileSync(values.from, "utf8") : FS.readFileSync(0, "utf8");
const line = values.from
  ? raw.split("\n").find((l) => /^\s*(?:export\s+)?AI_GATEWAY_API_KEY\s*=/.test(l))
  : raw;
const key = line
  ?.replace(/^\s*(?:export\s+)?AI_GATEWAY_API_KEY\s*=\s*/, "")
  .trim()
  .replace(/^["']|["']$/g, "");
if (!key) throw new Error("no AI_GATEWAY_API_KEY found");

const dir = Path.join(home, "userdata", "secrets");
FS.mkdirSync(dir, { recursive: true, mode: 0o700 });
const target = Path.join(dir, "nofun-ai-gateway.bin");
FS.writeFileSync(target, key, { mode: 0o600 });
FS.chmodSync(target, 0o600);
console.log(`Stored the gateway key (${key.length} chars) in ${target}`);
