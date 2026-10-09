import { mkdir } from "node:fs/promises";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

/**
 * UNSAFE local fallback: tools run on the host as the Nova process user.
 * Use only for development when Docker is unavailable.
 */
export async function createLocalExecutionEnv(workspacePath: string): Promise<ExecutionEnv> {
  await mkdir(workspacePath, { recursive: true });
  return new NodeExecutionEnv({ cwd: workspacePath });
}
