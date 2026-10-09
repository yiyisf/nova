import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { ApprovalBroker, HarnessManager } from "@nova/runtime";
import { SandboxManager } from "@nova/sandbox";
import { loadMasterKey, parseEnv } from "@nova/shared";
import { createApp, createApprovalStore, loadBot, loadUserModels } from "./app.ts";
import { createDb, createSql } from "./db/client.ts";
import { migrate } from "./db/migrate.ts";

const env = parseEnv();
await mkdir(env.DATA_DIR, { recursive: true });
await mkdir(env.WORKSPACE_DIR, { recursive: true });
await mkdir(env.HARNESS_DIR, { recursive: true });
await migrate(env.DATABASE_URL);

const sql = createSql(env.DATABASE_URL);
const db = createDb(sql);
const masterKey = loadMasterKey(env.NOVA_MASTER_KEY);
const sandbox = new SandboxManager({
  mode: env.SANDBOX_MODE,
  workspaceDir: env.WORKSPACE_DIR,
  hostWorkspaceDir: env.SANDBOX_HOST_WORKSPACE_DIR,
  image: env.SANDBOX_IMAGE,
  memory: env.SANDBOX_MEMORY,
  cpus: env.SANDBOX_CPUS,
  pids: env.SANDBOX_PIDS,
});
const approvals = new ApprovalBroker(createApprovalStore(db));
const harness = new HarnessManager({
  harnessDir: env.HARNESS_DIR,
  sandbox,
  approvals,
  search: {
    provider: env.WEB_SEARCH_PROVIDER,
    tavilyApiKey: env.TAVILY_API_KEY,
    braveApiKey: env.BRAVE_SEARCH_API_KEY,
    searxngBaseUrl: env.SEARXNG_BASE_URL,
  },
  loadUserModels: (userId) => loadUserModels(db, masterKey, userId),
  loadBot: (userId, botId) => loadBot(db, userId, botId),
});

const app = createApp({ db, env, masterKey, harness, approvals });

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`Nova API listening on http://${info.address}:${info.port}`);
  if (env.SANDBOX_MODE === "local") {
    console.warn("SANDBOX_MODE=local: tool execution is UNSAFE (runs on the host).");
  }
});

const shutdown = async () => {
  server.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
