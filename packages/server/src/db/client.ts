import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.ts";

export type Database = PostgresJsDatabase<typeof schema>;

export function createSql(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 10, idle_timeout: 20 });
}

export function createDb(sql: Sql): Database {
  return drizzle(sql, { schema });
}
