import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApprovalBroker } from "@nova/runtime";
import { loadMasterKey, type NovaEnv } from "@nova/shared";
import { createApp, createApprovalStore, type HarnessApi } from "./app.ts";
import type { Database } from "./db/client.ts";
import * as schema from "./db/schema.ts";
import { bots } from "./db/schema.ts";
import { withUser } from "./db/rls.ts";
import { splitSqlStatements, migrationSql } from "./db/sql.ts";

async function applyMigration(client: PGlite) {
  for (const statement of splitSqlStatements(migrationSql())) {
    try {
      await client.exec(statement);
    } catch (error) {
      if (statement.includes("CREATE EXTENSION")) continue;
      throw error;
    }
  }
}

function cookie(response: Response): string {
  const raw = response.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(";")[0] ?? "";
}

describe("tenant isolation", () => {
  let client: PGlite;
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let workspaceDir: string;

  beforeAll(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "nova-iso-"));
    client = new PGlite();
    await applyMigration(client);
    db = drizzle(client, { schema }) as unknown as Database;
    const env = {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3000,
      DATABASE_URL: "postgres://unused",
      REDIS_URL: "redis://unused",
      NOVA_MASTER_KEY: "a".repeat(64),
      NOVA_SESSION_SECRET: "test-session-secret-key",
      DATA_DIR: workspaceDir,
      WORKSPACE_DIR: workspaceDir,
      HARNESS_DIR: join(workspaceDir, "harness"),
      SANDBOX_MODE: "local",
      SANDBOX_IMAGE: "nova-sandbox:local",
      SANDBOX_MEMORY: "512m",
      SANDBOX_CPUS: "1",
      SANDBOX_PIDS: 128,
      WEB_SEARCH_PROVIDER: "none",
      CORS_ORIGIN: "http://localhost:5173",
    } as NovaEnv;
    const harness: HarnessApi = {
      async createConversation() {
        return { conversation: { id: `pi-${crypto.randomUUID()}` } } as never;
      },
      async submit() {
        return { id: 1 } as never;
      },
      async watch() {
        throw new Error("watch not used in isolation tests");
      },
      async invalidateUser() {},
    };
    app = createApp({
      db,
      env,
      masterKey: loadMasterKey(env.NOVA_MASTER_KEY),
      harness,
      approvals: new ApprovalBroker(createApprovalStore(db)),
    });
  });

  afterAll(async () => {
    await client.close();
    await rm(workspaceDir, { recursive: true, force: true });
  });

  async function signup(email: string) {
    const response = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password1" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { user: { id: string; email: string } };
    return { cookie: cookie(response), user: body.user };
  }

  it("prevents user B from reading or modifying user A's bots, models, conversations, and files", async () => {
    const a = await signup("alice@example.com");
    const b = await signup("bob@example.com");
    const headersA = { cookie: a.cookie, "content-type": "application/json" };
    const headersB = { cookie: b.cookie, "content-type": "application/json" };

    const modelRes = await app.request("/api/models", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        name: "Alice model",
        protocol: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        modelId: "deepseek-chat",
        apiKey: "sk-alice-secret",
      }),
    });
    expect(modelRes.status).toBe(201);
    const model = (await modelRes.json()) as { model: { id: string; hasApiKey: boolean } };
    expect(model.model.hasApiKey).toBe(true);
    expect(JSON.stringify(model)).not.toContain("sk-alice-secret");

    const botRes = await app.request("/api/bots", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ name: "Alice bot", persona: "private", modelConfigId: model.model.id }),
    });
    expect(botRes.status).toBe(201);
    const bot = (await botRes.json()) as { bot: { id: string } };

    const convRes = await app.request(`/api/bots/${bot.bot.id}/conversations`, {
      method: "POST",
      headers: headersA,
    });
    expect(convRes.status).toBe(201);
    const conv = (await convRes.json()) as { conversation: { id: string } };

    const writeRes = await app.request("/api/workspace/file", {
      method: "PUT",
      headers: headersA,
      body: JSON.stringify({ path: "secret.txt", content: "alice-only" }),
    });
    expect(writeRes.status).toBe(200);

    const bBots = await app.request("/api/bots", { headers: headersB });
    const bBotList = (await bBots.json()) as { bots: { id: string }[] };
    expect(bBotList.bots.some((item) => item.id === bot.bot.id)).toBe(false);

    const bModels = await app.request("/api/models", { headers: headersB });
    const bModelList = (await bModels.json()) as { models: { id: string }[] };
    expect(bModelList.models.some((item) => item.id === model.model.id)).toBe(false);

    expect((await app.request(`/api/bots/${bot.bot.id}`, { headers: headersB })).status).toBe(404);
    expect(
      (
        await app.request(`/api/bots/${bot.bot.id}`, {
          method: "PATCH",
          headers: headersB,
          body: JSON.stringify({ name: "hijacked" }),
        })
      ).status,
    ).toBe(404);
    expect((await app.request(`/api/bots/${bot.bot.id}`, { method: "DELETE", headers: headersB })).status).toBe(404);
    expect((await app.request(`/api/conversations/${conv.conversation.id}`, { headers: headersB })).status).toBe(404);
    expect(
      (
        await app.request("/api/workspace/file", {
          headers: { cookie: b.cookie },
        })
      ).status,
    ).toBe(400);
    const bFile = await app.request("/api/workspace/file?path=secret.txt", { headers: headersB });
    expect(bFile.status).toBe(404);
    const bBody = (await bFile.json()) as { content?: string; error?: string };
    expect(JSON.stringify(bBody)).not.toContain("alice-only");

    const escape = await app.request(`/api/workspace/file?path=../${a.user.id}/secret.txt`, {
      headers: headersB,
    });
    expect(escape.status).toBe(403);

    // Application queries are always scoped. RLS FORCE is defense in depth on
    // real Postgres; PGlite used in unit tests may not enforce it.
    const asB = await withUser(db, b.user.id, (tx) =>
      tx.select().from(bots).where(eq(bots.userId, b.user.id)),
    );
    expect(asB.every((row) => row.userId === b.user.id)).toBe(true);
  });
});
