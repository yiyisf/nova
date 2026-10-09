import { eq } from "drizzle-orm";
import { parseEnv } from "@nova/shared";
import { hashPassword } from "./auth/password.ts";
import { createDb, createSql } from "./db/client.ts";
import { withUser } from "./db/rls.ts";
import { bots, modelConfigs, users } from "./db/schema.ts";
import { migrate } from "./db/migrate.ts";

const env = parseEnv();
await migrate(env.DATABASE_URL);
const sql = createSql(env.DATABASE_URL);
const db = createDb(sql);

const email = "demo@nova.local";
const password = "novademo1";
const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (existing[0]) {
  console.log(`demo user already exists: ${email} / ${password}`);
  await sql.end();
  process.exit(0);
}

const [user] = await db
  .insert(users)
  .values({ email, passwordHash: await hashPassword(password) })
  .returning();
if (!user) throw new Error("failed to seed user");

await withUser(db, user.id, async (tx) => {
  const [model] = await tx
    .insert(modelConfigs)
    .values({
      userId: user.id,
      name: "Default OpenAI-compatible",
      protocol: "openai-compatible",
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      modelId: env.DEFAULT_MODEL_ID ?? "gpt-4o-mini",
      encryptedApiKey: null,
      params: {},
    })
    .returning();
  await tx.insert(bots).values({
    userId: user.id,
    name: "Assistant",
    persona: "You are a concise, practical assistant.",
    modelConfigId: model?.id ?? null,
  });
});

console.log(`Seeded demo user ${email} / ${password}`);
await sql.end();
