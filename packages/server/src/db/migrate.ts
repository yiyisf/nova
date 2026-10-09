import postgres from "postgres";
import { parseEnv } from "@nova/shared";
import { migrationSql, splitSqlStatements } from "./sql.ts";

export async function migrate(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const statement of splitSqlStatements(migrationSql())) {
      await sql.unsafe(statement);
    }
  } finally {
    await sql.end();
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("migrate.ts") || entry.endsWith("migrate.js")) {
  const env = parseEnv();
  await migrate(env.DATABASE_URL);
  console.log("migrations applied");
}
