import { eq } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { randomToken, sha256Base64Url } from "@nova/shared";
import type { Database } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";

export const SESSION_COOKIE = "nova_session";
const SESSION_DAYS = 14;

export type AuthUser = {
  id: string;
  email: string;
  createdAt: Date;
};

export async function createSession(
  db: Database,
  c: Context,
  userId: string,
  secure: boolean,
): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256Base64Url(token),
    expiresAt,
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(db: Database, c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256Base64Url(token)));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function loadUserFromCookie(db: Database, c: Context): Promise<AuthUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const hash = sha256Base64Url(token);
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hash));
    return null;
  }
  return { id: row.id, email: row.email, createdAt: row.createdAt };
}
