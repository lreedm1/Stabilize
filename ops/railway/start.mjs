import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
if (!mount) throw new Error("A persistent volume is required for the staging token ledger");
const { vars, compatibility_date, compatibility_flags } = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const bundle = await build({
  entryPoints: ["ops/railway/guest-worker.js"], bundle: true, write: false,
  format: "esm", external: ["cloudflare:workers"], target: "es2022",
});
const bindings = { DEMO_MODE: "false", OPENAI_FREE_TOKENS_ONLY: "true" };
for (const name of ["OPENAI_MODEL", "OPENAI_REASONING_EFFORT", "OPENAI_FREE_TOKEN_ALLOWANCE", "OPENAI_FREE_TOKEN_DAILY_LIMIT"]) {
  bindings[name] = vars[name];
}
bindings.OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED = process.env.OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED ?? "false";
for (const name of ["OPENAI_API_KEY", "OPENAI_USAGE_ADMIN_KEY", "OPENAI_ORGANIZATION_ID"]) {
  if (process.env[name]) bindings[name] = process.env[name];
}
const runtime = new Miniflare({
  host: "127.0.0.1", cf: false, port: 0, modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: compatibility_date, compatibilityFlags: compatibility_flags,
  bindings, durableObjectsPersist: join(mount, "guest-state"),
  durableObjects: { OPENAI_TOKEN_BUDGET: { className: "OpenAITokenBudget", useSQLite: true } },
});
const worker = await runtime.getWorker();
const server = createServer(async (req, res) => {
  try {
    if (!["/health", "/api/chat"].includes(req.url)) {
      res.writeHead(404).end();
      return;
    }
    const origin = req.headers.origin;
    if (origin && origin !== 'https://' + req.headers.host) {
      res.writeHead(403).end();
      return;
    }
    const headers = {};
    for (const name of ["accept", "content-type"]) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    const response = await worker.fetch("https://guest.staging.invalid" + req.url, {
      method: req.method, headers, body: req.method === "POST" ? Readable.toWeb(req) : undefined,
      duplex: "half",
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch {
    if (!res.headersSent) res.writeHead(503);
    res.end();
  }
});
server.listen(Number(process.env.PORT || 3000), "::");
process.once("SIGTERM", () => server.close(() => runtime.dispose()));
