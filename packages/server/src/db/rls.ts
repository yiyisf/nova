import { sql } from "drizzle-orm";
import type { Database } from "./client.ts";

/** Run a unit of work with `app.user_id` set so RLS policies can see the tenant. */
export async function withUser<T>(
  db: Database,
  userId: string,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return work(tx as unknown as Database);
  });
}
