import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  ApprovalBroker,
  HarnessManager,
  novaProviderId,
  type BotRuntimeConfig,
  type UserModelConfig,
} from "@nova/runtime";
import {
  decryptSecret,
  encryptSecret,
  type NovaEnv,
  type Protocol,
} from "@nova/shared";
import { hashPassword, verifyPassword } from "./auth/password.ts";
import { createSession, destroySession, loadUserFromCookie, type AuthUser } from "./auth/session.ts";
import type { Database } from "./db/client.ts";
import { withUser } from "./db/rls.ts";
import {
  approvals,
  bots,
  conversations,
  modelConfigs,
  users,
} from "./db/schema.ts";
import {
  presentApproval,
  presentBot,
  presentConversation,
  presentModelConfig,
  presentUser,
} from "./present.ts";
import { listWorkspace, readWorkspaceFile, WorkspaceError, writeWorkspaceFile } from "./workspace.ts";

export type AppVars = { user: AuthUser };

export type HarnessApi = Pick<
  HarnessManager,
  "createConversation" | "submit" | "watch" | "invalidateUser"
>;

export type AppDeps = {
  db: Database;
  env: NovaEnv;
  masterKey: Buffer;
  harness: HarnessApi;
  approvals: ApprovalBroker;
};

function jsonError(message: string, status: number) {
  return { error: message, status };
}

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AppVars }>();
  const secure = Boolean(deps.env.COOKIE_SECURE) || deps.env.NODE_ENV === "production";

  app.use(
    "/*",
    cors({
      origin: deps.env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      credentials: true,
    }),
  );

  app.onError((error, c) => {
    if (error instanceof WorkspaceError) {
      return c.json({ error: error.message }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : "Internal error";
    if (/api[_-]?key|authorization|secret|password/i.test(message)) {
      console.error("[nova] request failed (redacted)");
      return c.json({ error: "Internal error" }, 500);
    }
    console.error("[nova]", message);
    return c.json({ error: message }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/auth/signup", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || !email.includes("@") || password.length < 8) {
      return c.json(jsonError("Email and a password of at least 8 characters are required", 400), 400);
    }
    const existing = await deps.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) return c.json(jsonError("Email already registered", 409), 409);
    const [user] = await deps.db
      .insert(users)
      .values({ email, passwordHash: await hashPassword(password) })
      .returning();
    if (!user) return c.json(jsonError("Failed to create user", 500), 500);
    await createSession(deps.db, c, user.id, secure);
    return c.json({ user: presentUser(user) }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    const [user] = await deps.db.select().from(users).where(eq(users.email, email ?? "")).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      return c.json(jsonError("Invalid email or password", 401), 401);
    }
    await createSession(deps.db, c, user.id, secure);
    return c.json({ user: presentUser(user) });
  });

  app.post("/api/auth/logout", async (c) => {
    await destroySession(deps.db, c);
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", async (c) => {
    const user = await loadUserFromCookie(deps.db, c);
    if (!user) return c.json(jsonError("Unauthorized", 401), 401);
    return c.json({
      user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
    });
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/") || c.req.path === "/api/health") {
      return next();
    }
    const user = await loadUserFromCookie(deps.db, c);
    if (!user) return c.json(jsonError("Unauthorized", 401), 401);
    c.set("user", user);
    return next();
  });

  app.get("/api/models", async (c) => {
    const user = c.get("user");
    const rows = await withUser(deps.db, user.id, (tx) =>
      tx.select().from(modelConfigs).where(eq(modelConfigs.userId, user.id)).orderBy(desc(modelConfigs.createdAt)),
    );
    return c.json({ models: rows.map(presentModelConfig) });
  });

  app.post("/api/models", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{
      name?: string;
      protocol?: Protocol;
      baseUrl?: string;
      modelId?: string;
      apiKey?: string;
      params?: Record<string, unknown>;
    }>();
    if (!body.name || !body.modelId || !body.protocol) {
      return c.json(jsonError("name, protocol, and modelId are required", 400), 400);
    }
    if (body.protocol !== "openai-compatible" && body.protocol !== "anthropic") {
      return c.json(jsonError("protocol must be openai-compatible or anthropic", 400), 400);
    }
    const [row] = await withUser(deps.db, user.id, (tx) =>
      tx
        .insert(modelConfigs)
        .values({
          userId: user.id,
          name: body.name!,
          protocol: body.protocol!,
          baseUrl: body.baseUrl || null,
          modelId: body.modelId!,
          encryptedApiKey: body.apiKey ? encryptSecret(body.apiKey, deps.masterKey) : null,
          params: (body.params ?? {}) as typeof modelConfigs.$inferInsert.params,
        })
        .returning(),
    );
    if (!row) return c.json(jsonError("Failed to save model", 500), 500);
    await deps.harness.invalidateUser(user.id);
    return c.json({ model: presentModelConfig(row) }, 201);
  });

  app.patch("/api/models/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = await c.req.json<{
      name?: string;
      baseUrl?: string | null;
      modelId?: string;
      apiKey?: string | null;
      params?: Record<string, unknown>;
    }>();
    const [row] = await withUser(deps.db, user.id, async (tx) => {
      const patch: Partial<typeof modelConfigs.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = body.name;
      if (body.baseUrl !== undefined) patch.baseUrl = body.baseUrl;
      if (body.modelId !== undefined) patch.modelId = body.modelId;
      if (body.params !== undefined) patch.params = body.params as typeof modelConfigs.$inferInsert.params;
      if (body.apiKey === null) patch.encryptedApiKey = null;
      else if (typeof body.apiKey === "string" && body.apiKey.length > 0) {
        patch.encryptedApiKey = encryptSecret(body.apiKey, deps.masterKey);
      }
      return tx
        .update(modelConfigs)
        .set(patch)
        .where(and(eq(modelConfigs.id, id), eq(modelConfigs.userId, user.id)))
        .returning();
    });
    if (!row) return c.json(jsonError("Model not found", 404), 404);
    await deps.harness.invalidateUser(user.id);
    return c.json({ model: presentModelConfig(row) });
  });

  app.delete("/api/models/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const deleted = await withUser(deps.db, user.id, (tx) =>
      tx
        .delete(modelConfigs)
        .where(and(eq(modelConfigs.id, id), eq(modelConfigs.userId, user.id)))
        .returning({ id: modelConfigs.id }),
    );
    if (!deleted[0]) return c.json(jsonError("Model not found", 404), 404);
    await deps.harness.invalidateUser(user.id);
    return c.json({ ok: true });
  });

  app.get("/api/bots", async (c) => {
    const user = c.get("user");
    const rows = await withUser(deps.db, user.id, (tx) =>
      tx.select().from(bots).where(eq(bots.userId, user.id)).orderBy(desc(bots.createdAt)),
    );
    return c.json({ bots: rows.map(presentBot) });
  });

  app.post("/api/bots", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ name?: string; persona?: string; modelConfigId?: string | null }>();
    if (!body.name?.trim()) return c.json(jsonError("name is required", 400), 400);
    const [row] = await withUser(deps.db, user.id, (tx) =>
      tx
        .insert(bots)
        .values({
          userId: user.id,
          name: body.name!.trim(),
          persona: body.persona ?? "",
          modelConfigId: body.modelConfigId ?? null,
        })
        .returning(),
    );
    if (!row) return c.json(jsonError("Failed to create bot", 500), 500);
    return c.json({ bot: presentBot(row) }, 201);
  });

  app.get("/api/bots/:id", async (c) => {
    const user = c.get("user");
    const [row] = await withUser(deps.db, user.id, (tx) =>
      tx.select().from(bots).where(and(eq(bots.id, c.req.param("id")), eq(bots.userId, user.id))).limit(1),
    );
    if (!row) return c.json(jsonError("Bot not found", 404), 404);
    return c.json({ bot: presentBot(row) });
  });

  app.patch("/api/bots/:id", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ name?: string; persona?: string; modelConfigId?: string | null }>();
    const [row] = await withUser(deps.db, user.id, (tx) =>
      tx
        .update(bots)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.persona !== undefined ? { persona: body.persona } : {}),
          ...(body.modelConfigId !== undefined ? { modelConfigId: body.modelConfigId } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(bots.id, c.req.param("id")), eq(bots.userId, user.id)))
        .returning(),
    );
    if (!row) return c.json(jsonError("Bot not found", 404), 404);
    return c.json({ bot: presentBot(row) });
  });

  app.delete("/api/bots/:id", async (c) => {
    const user = c.get("user");
    const deleted = await withUser(deps.db, user.id, (tx) =>
      tx
        .delete(bots)
        .where(and(eq(bots.id, c.req.param("id")), eq(bots.userId, user.id)))
        .returning({ id: bots.id }),
    );
    if (!deleted[0]) return c.json(jsonError("Bot not found", 404), 404);
    return c.json({ ok: true });
  });

  app.get("/api/bots/:id/conversations", async (c) => {
    const user = c.get("user");
    const botId = c.req.param("id");
    const rows = await withUser(deps.db, user.id, (tx) =>
      tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.botId, botId), eq(conversations.userId, user.id)))
        .orderBy(desc(conversations.updatedAt)),
    );
    return c.json({ conversations: rows.map(presentConversation) });
  });

  app.post("/api/bots/:id/conversations", async (c) => {
    const user = c.get("user");
    const botId = c.req.param("id");
    const bot = await withUser(deps.db, user.id, (tx) =>
      tx.select().from(bots).where(and(eq(bots.id, botId), eq(bots.userId, user.id))).limit(1),
    );
    if (!bot[0]) return c.json(jsonError("Bot not found", 404), 404);
    const created = await deps.harness.createConversation(user.id, botId);
    const [row] = await withUser(deps.db, user.id, (tx) =>
      tx
        .insert(conversations)
        .values({
          userId: user.id,
          botId,
          title: "New conversation",
          piConversationId: String(created.conversation.id),
        })
        .returning(),
    );
    if (!row) return c.json(jsonError("Failed to create conversation", 500), 500);
    return c.json({ conversation: presentConversation(row) }, 201);
  });

  app.get("/api/conversations/:id", async (c) => {
    const user = c.get("user");
    const [row] = await withUser(deps.db, user.id, (tx) =>
      tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, c.req.param("id")), eq(conversations.userId, user.id)))
        .limit(1),
    );
    if (!row) return c.json(jsonError("Conversation not found", 404), 404);
    return c.json({ conversation: presentConversation(row) });
  });

  app.delete("/api/conversations/:id", async (c) => {
    const user = c.get("user");
    const deleted = await withUser(deps.db, user.id, (tx) =>
      tx
        .delete(conversations)
        .where(and(eq(conversations.id, c.req.param("id")), eq(conversations.userId, user.id)))
        .returning({ id: conversations.id }),
    );
    if (!deleted[0]) return c.json(jsonError("Conversation not found", 404), 404);
    return c.json({ ok: true });
  });

  app.post("/api/conversations/:id/messages", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ content?: string; requestId?: string }>();
    if (!body.content?.trim()) return c.json(jsonError("content is required", 400), 400);
    const [row] = await withUser(deps.db, user.id, (tx) =>
      tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, c.req.param("id")), eq(conversations.userId, user.id)))
        .limit(1),
    );
    if (!row) return c.json(jsonError("Conversation not found", 404), 404);
    await withUser(deps.db, user.id, (tx) =>
      tx
        .update(conversations)
        .set({
          updatedAt: new Date(),
          title: row.title === "New conversation" ? body.content!.trim().slice(0, 80) : row.title,
        })
        .where(eq(conversations.id, row.id)),
    );
    const submission = await deps.harness.submit(user.id, row.piConversationId, body.content.trim(), body.requestId);
    return c.json({ submissionId: submission.id });
  });

  app.get("/api/conversations/:id/events", async (c) => {
    const user = c.get("user");
    const [row] = await withUser(deps.db, user.id, (tx) =>
      tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, c.req.param("id")), eq(conversations.userId, user.id)))
        .limit(1),
    );
    if (!row) return c.json(jsonError("Conversation not found", 404), 404);
    const pendingApprovals = await withUser(deps.db, user.id, (tx) =>
      tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.conversationId, row.id), eq(approvals.userId, user.id))),
    );
    const stream = await deps.harness.watch(user.id, row.piConversationId);
    return streamSSE(c, async (sse) => {
      await sse.writeSSE({ event: "snapshot", data: JSON.stringify(stream.snapshot) });
      for (const approval of pendingApprovals) {
        await sse.writeSSE({ event: "approval", data: JSON.stringify(presentApproval(approval)) });
      }
      const onApproval = (approval: { userId: string; conversationId: string }) => {
        if (approval.userId !== user.id || approval.conversationId !== row.id) return;
        void sse.writeSSE({ event: "approval", data: JSON.stringify(approval) });
      };
      deps.approvals.on("requested", onApproval);
      deps.approvals.on("decided", onApproval);
      stream.start(async (events) => {
        await sse.writeSSE({ event: "agent", data: JSON.stringify(events) });
      });
      await stream.closed.catch(() => undefined);
      deps.approvals.off("requested", onApproval);
      deps.approvals.off("decided", onApproval);
      await stream.stop().catch(() => undefined);
    });
  });

  app.get("/api/approvals", async (c) => {
    const user = c.get("user");
    const conversationId = c.req.query("conversationId");
    const rows = await withUser(deps.db, user.id, (tx) => {
      const cond = conversationId
        ? and(
            eq(approvals.userId, user.id),
            eq(approvals.conversationId, conversationId),
            eq(approvals.status, "pending"),
          )
        : and(eq(approvals.userId, user.id), eq(approvals.status, "pending"));
      return tx.select().from(approvals).where(cond).orderBy(desc(approvals.createdAt));
    });
    return c.json({ approvals: rows.map(presentApproval) });
  });

  app.post("/api/approvals/:id/approve", async (c) => {
    const user = c.get("user");
    const owned = await withUser(deps.db, user.id, (tx) =>
      tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.id, c.req.param("id")), eq(approvals.userId, user.id)))
        .limit(1),
    );
    if (!owned[0]) return c.json(jsonError("Approval not found", 404), 404);
    const row = await deps.approvals.decide(user.id, c.req.param("id"), "approved");
    if (!row) return c.json(jsonError("Approval not found", 404), 404);
    return c.json({ approval: row });
  });

  app.post("/api/approvals/:id/deny", async (c) => {
    const user = c.get("user");
    const owned = await withUser(deps.db, user.id, (tx) =>
      tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.id, c.req.param("id")), eq(approvals.userId, user.id)))
        .limit(1),
    );
    if (!owned[0]) return c.json(jsonError("Approval not found", 404), 404);
    const row = await deps.approvals.decide(user.id, c.req.param("id"), "denied");
    if (!row) return c.json(jsonError("Approval not found", 404), 404);
    return c.json({ approval: row });
  });

  app.get("/api/workspace", async (c) => {
    const user = c.get("user");
    const path = c.req.query("path") ?? ".";
    const entries = await listWorkspace(deps.env.WORKSPACE_DIR, user.id, path);
    return c.json({ entries });
  });

  app.get("/api/workspace/file", async (c) => {
    const user = c.get("user");
    const path = c.req.query("path");
    if (!path) return c.json(jsonError("path is required", 400), 400);
    const content = await readWorkspaceFile(deps.env.WORKSPACE_DIR, user.id, path);
    return c.json({ content });
  });

  app.put("/api/workspace/file", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ path?: string; content?: string }>();
    if (!body.path) return c.json(jsonError("path is required", 400), 400);
    await writeWorkspaceFile(deps.env.WORKSPACE_DIR, user.id, body.path, body.content ?? "");
    return c.json({ ok: true });
  });

  return app;
}

export function createApprovalStore(db: Database): ConstructorParameters<typeof ApprovalBroker>[0] {
  return {
    async findByTaskId(userId, taskId) {
      const [row] = await withUser(db, userId, (tx) =>
        tx
          .select()
          .from(approvals)
          .where(and(eq(approvals.taskId, taskId), eq(approvals.userId, userId)))
          .limit(1),
      );
      return row ? presentApproval(row) : undefined;
    },
    async create(request) {
      return withUser(db, request.userId, async (tx) => {
        const [conversation] = await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.piConversationId, request.piConversationId),
              eq(conversations.userId, request.userId),
            ),
          )
          .limit(1);
        if (!conversation) {
          throw new Error("Conversation not found for approval");
        }
        const [row] = await tx
          .insert(approvals)
          .values({
            userId: request.userId,
            conversationId: conversation.id,
            taskId: request.taskId,
            toolName: request.toolName,
            arguments: request.arguments,
            status: "pending",
          })
          .returning();
        if (!row) throw new Error("Failed to create approval");
        return presentApproval(row);
      });
    },
    async decide(userId, id, status) {
      const [row] = await withUser(db, userId, (tx) =>
        tx
          .update(approvals)
          .set({ status, decidedAt: new Date() })
          .where(and(eq(approvals.id, id), eq(approvals.userId, userId)))
          .returning(),
      );
      return row ? presentApproval(row) : undefined;
    },
    async get(userId, id) {
      const [row] = await withUser(db, userId, (tx) =>
        tx
          .select()
          .from(approvals)
          .where(and(eq(approvals.id, id), eq(approvals.userId, userId)))
          .limit(1),
      );
      return row ? presentApproval(row) : undefined;
    },
  };
}

export async function loadUserModels(db: Database, masterKey: Buffer, userId: string): Promise<UserModelConfig[]> {
  const rows = await withUser(db, userId, (tx) =>
    tx.select().from(modelConfigs).where(eq(modelConfigs.userId, userId)),
  );
  return rows.map((row) => ({
    providerId: novaProviderId(row.id),
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    apiKey: row.encryptedApiKey ? decryptSecret(row.encryptedApiKey, masterKey) : null,
  }));
}

export async function loadBot(db: Database, userId: string, botId: string): Promise<BotRuntimeConfig> {
  const [bot] = await withUser(db, userId, (tx) =>
    tx.select().from(bots).where(and(eq(bots.id, botId), eq(bots.userId, userId))).limit(1),
  );
  if (!bot) throw new Error("Bot not found");
  let model = { provider: "openai", modelId: "gpt-4o-mini" };
  let params: BotRuntimeConfig["params"];
  if (bot.modelConfigId) {
    const [config] = await withUser(db, userId, (tx) =>
      tx
        .select()
        .from(modelConfigs)
        .where(and(eq(modelConfigs.id, bot.modelConfigId!), eq(modelConfigs.userId, userId)))
        .limit(1),
    );
    if (config) {
      model = { provider: novaProviderId(config.id), modelId: config.modelId };
      params = config.params;
    }
  } else if (process.env.DEFAULT_MODEL_PROVIDER && process.env.DEFAULT_MODEL_ID) {
    model = { provider: process.env.DEFAULT_MODEL_PROVIDER, modelId: process.env.DEFAULT_MODEL_ID };
  }
  return {
    botId: bot.id,
    botName: bot.name,
    persona: bot.persona,
    model,
    params,
  };
}
