import { join } from "node:path";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { createDockerExecutionEnv } from "./docker.ts";
import { createLocalExecutionEnv } from "./local.ts";

export type SandboxMode = "docker" | "local";

export type SandboxManagerOptions = {
  mode: SandboxMode;
  workspaceDir: string;
  hostWorkspaceDir?: string;
  image: string;
  memory: string;
  cpus: string;
  pids: number;
};

export class SandboxManager {
  private readonly options: SandboxManagerOptions;
  private readonly cache = new Map<string, Promise<ExecutionEnv>>();

  constructor(options: SandboxManagerOptions) {
    this.options = options;
  }

  workspacePath(userId: string): string {
    return join(this.options.workspaceDir, userId);
  }

  async envForUser(userId: string): Promise<ExecutionEnv> {
    let pending = this.cache.get(userId);
    if (!pending) {
      pending = this.create(userId);
      this.cache.set(userId, pending);
    }
    return pending;
  }

  private async create(userId: string): Promise<ExecutionEnv> {
    const workspacePath = this.workspacePath(userId);
    if (this.options.mode === "docker") {
      try {
        return await createDockerExecutionEnv({
          userId,
          workspacePath,
          hostWorkspacePath: this.options.hostWorkspaceDir
            ? join(this.options.hostWorkspaceDir, userId)
            : undefined,
          image: this.options.image,
          memory: this.options.memory,
          cpus: this.options.cpus,
          pids: this.options.pids,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[nova] Docker sandbox unavailable (${message}); falling back to UNSAFE local execution for user ${userId}`,
        );
      }
    } else {
      console.warn(
        `[nova] SANDBOX_MODE=local: tools run on the host filesystem (UNSAFE). User workspace: ${workspacePath}`,
      );
    }
    return createLocalExecutionEnv(workspacePath);
  }
}
