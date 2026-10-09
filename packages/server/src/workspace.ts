import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

function resolveSafe(workspaceDir: string, userId: string, requested: string): string {
  const root = resolve(workspaceDir, userId);
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (rel.startsWith("..") || (target !== root && !target.startsWith(`${root}${sep}`))) {
    throw new WorkspaceError("Path is outside the workspace", 403);
  }
  return target;
}

export async function listWorkspace(workspaceDir: string, userId: string, path: string) {
  const dir = resolveSafe(workspaceDir, userId, path);
  await mkdir(resolve(workspaceDir, userId), { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const info = await stat(join(dir, entry.name));
      return {
        name: entry.name,
        path: join(path === "." ? "" : path, entry.name).replace(/\\/g, "/") || entry.name,
        kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        size: info.size,
      };
    }),
  );
}

export async function readWorkspaceFile(workspaceDir: string, userId: string, path: string): Promise<string> {
  const file = resolveSafe(workspaceDir, userId, path);
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new WorkspaceError("File not found", 404);
    throw error;
  }
}

export async function writeWorkspaceFile(
  workspaceDir: string,
  userId: string,
  path: string,
  content: string,
): Promise<void> {
  const file = resolveSafe(workspaceDir, userId, path);
  await mkdir(resolve(workspaceDir, userId), { recursive: true });
  await writeFile(file, content, "utf8");
}
