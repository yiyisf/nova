import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function migrationSql(): string {
  return readFileSync(join(here, "migrations/0001_init.sql"), "utf8");
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollar = false;
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--") && !inDollar) continue;
    if (trimmed.includes("$$") && !trimmed.includes("$$$$")) {
      const count = (trimmed.match(/\$\$/g) ?? []).length;
      if (count % 2 === 1) inDollar = !inDollar;
    }
    current += `${line}\n`;
    if (!inDollar && trimmed.endsWith(";")) {
      const stmt = current.trim();
      if (stmt.length > 0) statements.push(stmt);
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
