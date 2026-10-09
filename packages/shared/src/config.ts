import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default("postgres://nova:nova@127.0.0.1:5432/nova"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  NOVA_MASTER_KEY: z.string().min(8, "NOVA_MASTER_KEY is required"),
  NOVA_SESSION_SECRET: z.string().min(16).default("dev-session-secret-change-me"),
  DATA_DIR: z.string().default("./data"),
  WORKSPACE_DIR: z.string().default("./data/workspaces"),
  HARNESS_DIR: z.string().default("./data/harness"),
  SANDBOX_MODE: z.enum(["docker", "local"]).default("local"),
  SANDBOX_IMAGE: z.string().default("nova-sandbox:local"),
  SANDBOX_MEMORY: z.string().default("512m"),
  SANDBOX_CPUS: z.string().default("1"),
  SANDBOX_PIDS: z.coerce.number().default(128),
  /** Absolute host path of WORKSPACE_DIR, required when the API runs in Docker and drives sandboxes via the host daemon. */
  SANDBOX_HOST_WORKSPACE_DIR: z.string().optional(),
  WEB_SEARCH_PROVIDER: z.enum(["tavily", "brave", "searxng", "none"]).default("none"),
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  SEARXNG_BASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEFAULT_MODEL_PROVIDER: z.string().optional(),
  DEFAULT_MODEL_ID: z.string().optional(),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

export type NovaEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): NovaEnv {
  return envSchema.parse(source);
}
