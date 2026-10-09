import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "@nova/runtime";
import { loadMasterKey, type NovaEnv } from "@nova/shared";
import { createApp, createApprovalStore, type HarnessApi } from "./app.ts";
import type { Database } from "./db/client.ts";
import * as schema from "./db/schema.ts";
import { migrationSql, splitSqlStatements } from "./db/sql.ts";

describe("auth", () => {
  it("signs up, logs in, and rejects a bad password", async () => {
    const client = new PGlite();
    for (const statement of splitSqlStatements(migrationSql())) {
      try {
        await client.exec(statement);
      } catch {
        if (!statement.includes("CREATE EXTENSION")) throw new Error("migration failed");
      }
    }
    const db = drizzle(client, { schema }) as unknown as Database;
    const env = {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3000,
      DATABASE_URL: "postgres://unused",
      REDIS_URL: "redis://unused",
      NOVA_MASTER_KEY: "b".repeat(64),
      NOVA_SESSION_SECRET: "test-session-secret-key",
      DATA_DIR: "/tmp/nova-auth",
      WORKSPACE_DIR: "/tmp/nova-auth/ws",
      HARNESS_DIR: "/tmp/nova-auth/h",
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
        return { conversation: { id: "pi-1" } } as never;
      },
      async submit() {
        return { id: 1 } as never;
      },
      async watch() {
        throw new Error("unused");
      },
      async invalidateUser() {},
    };
    const app = createApp({
      db,
      env,
      masterKey: loadMasterKey(env.NOVA_MASTER_KEY),
      harness,
      approvals: new ApprovalBroker(createApprovalStore(db)),
    });

    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password: "password1" }),
    });
    expect(signup.status).toBe(201);
    const me = await app.request("/api/auth/me", {
      headers: { cookie: signup.headers.get("set-cookie")?.split(";")[0] ?? "" },
    });
    expect(me.status).toBe(200);

    const bad = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password: "wrong-pass" }),
    });
    expect(bad.status).toBe(401);
    await client.close();
  });
});
