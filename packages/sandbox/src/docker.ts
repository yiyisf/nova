import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { Context } from "@earendil-works/chord";
import type {
  ExecutionEnv,
  ExecutionError,
  Result,
  ShellExecOptions,
  ShellExecResult,
} from "@earendil-works/pi-durable/env";
import { ExecutionError as ExecError, err, ok } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

export type DockerSandboxOptions = {
  userId: string;
  workspacePath: string;
  /** Path of the workspace as the Docker daemon sees it (host bind). Defaults to workspacePath. */
  hostWorkspacePath?: string;
  image: string;
  memory: string;
  cpus: string;
  pids: number;
};

function containerName(userId: string): string {
  return `nova-user-${userId.replace(/[^a-zA-Z0-9_.-]/g, "")}`;
}

async function runDocker(args: string[], timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`docker ${args[0]} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function ensureUserContainer(options: DockerSandboxOptions): Promise<string> {
  await mkdir(options.workspacePath, { recursive: true });
  const name = containerName(options.userId);
  const inspect = await runDocker(["inspect", "-f", "{{.State.Running}}", name]).catch(() => ({
    code: 1,
    stdout: "",
    stderr: "missing",
  }));
  if (inspect.code === 0 && inspect.stdout.trim() === "true") {
    return name;
  }
  if (inspect.code === 0) {
    await runDocker(["rm", "-f", name]).catch(() => undefined);
  }
  const hostPath = options.hostWorkspacePath ?? options.workspacePath;
  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--restart",
    "unless-stopped",
    "--memory",
    options.memory,
    "--cpus",
    options.cpus,
    "--pids-limit",
    String(options.pids),
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "-v",
    `${hostPath}:${options.workspacePath}`,
    "-w",
    options.workspacePath,
    options.image,
    "sleep",
    "infinity",
  ];
  const started = await runDocker(args);
  if (started.code !== 0) {
    throw new Error(`Failed to start sandbox container: ${started.stderr || started.stdout}`);
  }
  return name;
}

function wrapExec(base: ExecutionEnv, container: string, id: string): ExecutionEnv {
  const exec: ExecutionEnv["exec"] = async (command, options, context) => {
    return dockerExec(container, base.cwd, command, options, context);
  };
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "exec") return exec;
      if (prop === "id") return id;
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value === "function") {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  }) as ExecutionEnv;
}

async function dockerExec(
  container: string,
  defaultCwd: string,
  command: string | readonly string[],
  options: ShellExecOptions | undefined,
  context: Context,
): Promise<Result<ShellExecResult, ExecutionError>> {
  const signal = context.abortSignal;
  if (signal?.aborted) return err(new ExecError("aborted", "aborted"));
  const cwd = options?.cwd ?? defaultCwd;
  const dockerArgs = ["exec", "-i", "-w", cwd];
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      dockerArgs.push("-e", `${key}=${value}`);
    }
  }
  dockerArgs.push(container);
  if (typeof command === "string") {
    dockerArgs.push("bash", "-lc", command);
  } else {
    if (command.length === 0) {
      return err(new ExecError("spawn_error", "Empty argv: no program to run"));
    }
    dockerArgs.push(...command);
  }

  return new Promise((resolve) => {
    const child = spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const settle = (result: Result<ShellExecResult, ExecutionError>) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort);
    const emit = (text: string, stream: "stdout" | "stderr") => {
      if (!text || !options?.onOutput) return;
      try {
        options.onOutput(text, context, { stream });
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        settle(err(new ExecError("callback_error", cause.message, cause)));
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (chunk: Buffer) => emit(chunk.toString(), "stdout"));
    child.stderr.on("data", (chunk: Buffer) => emit(chunk.toString(), "stderr"));
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      settle(err(new ExecError("spawn_error", error.message, error)));
    });
    child.on("close", (code, killSignal) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        settle(err(new ExecError("aborted", "aborted")));
        return;
      }
      const exitCode = code ?? (killSignal ? 1 : 0);
      settle(ok({ exitCode }));
    });
  });
}

/**
 * Per-user Docker sandbox. File tools operate on the bind-mounted workspace (same
 * files as the container). Shell commands run inside the container via `docker exec`.
 */
export async function createDockerExecutionEnv(options: DockerSandboxOptions): Promise<ExecutionEnv> {
  const name = await ensureUserContainer(options);
  const files = new NodeExecutionEnv({ cwd: options.workspacePath });
  return wrapExec(files, name, `docker:${options.userId}`);
}
