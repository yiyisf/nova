#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type Config = { server: string; cookie?: string };

function configPath(): string {
  return join(homedir(), ".config", "nova", "config.json");
}

async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as Config;
  } catch {
    return { server: "http://127.0.0.1:3000" };
  }
}

async function saveConfig(config: Config): Promise<void> {
  const dir = join(homedir(), ".config", "nova");
  await mkdir(dir, { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

async function api<T>(config: Config, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.server}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(config.cookie ? { cookie: config.cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    config.cookie = setCookie.split(";")[0];
    await saveConfig(config);
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function login(config: Config, email: string, password: string) {
  await api(config, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  console.log(`Logged in at ${config.server}`);
}

async function listBots(config: Config) {
  const data = await api<{ bots: { id: string; name: string }[] }>(config, "/api/bots");
  for (const bot of data.bots) console.log(`${bot.id}\t${bot.name}`);
}

async function chat(config: Config, botId: string) {
  const created = await api<{ conversation: { id: string } }>(config, `/api/bots/${botId}/conversations`, {
    method: "POST",
  });
  const conversationId = created.conversation.id;
  console.log("Connected. Type a message, or /quit.");
  void readSse(`${config.server}/api/conversations/${conversationId}/events`, config.cookie ?? "");
  const rl = createInterface({ input, output });
  try {
    for (;;) {
      const line = await rl.question("> ");
      if (line === "/quit" || line === "/exit") break;
      if (!line.trim()) continue;
      await api(config, `/api/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: line }),
      });
    }
  } finally {
    rl.close();
  }
}

async function readSse(url: string, cookie: string) {
  const response = await fetch(url, { headers: cookie ? { cookie } : {} });
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const event = /event: (\S+)/.exec(chunk)?.[1];
      const dataLine = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (!event || !dataLine) continue;
      if (event === "agent") {
        try {
          const events = JSON.parse(dataLine) as { type: string; changes?: { delta?: string }[]; message?: { content?: unknown } }[];
          for (const item of events) {
            if (item.type === "message_update") {
              const delta = item.changes?.map((change) => change.delta ?? "").join("") ?? "";
              if (delta) output.write(delta);
            }
            if (item.type === "message_end") output.write("\n");
            if (item.type === "tool_execution_start") output.write(`\n[tool ${String((item as { toolName?: string }).toolName)}]\n`);
          }
        } catch {
          // ignore malformed frames
        }
      }
      if (event === "approval") {
        console.log("\n[approval required — open the web UI to approve or deny]");
      }
    }
  }
}

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const config = await loadConfig();

if (command === "login") {
  const serverFlag = args.indexOf("--server");
  if (serverFlag >= 0 && args[serverFlag + 1]) config.server = args[serverFlag + 1]!;
  const rl = createInterface({ input, output });
  const email = await rl.question("Email: ");
  const password = await rl.question("Password: ");
  rl.close();
  await login(config, email.trim(), password);
} else if (command === "bots") {
  await listBots(config);
} else if (command === "chat") {
  const botId = args[1];
  if (!botId) {
    console.error("usage: nova chat <bot-id>");
    process.exit(1);
  }
  await chat(config, botId);
} else {
  console.log(`nova — Nova CLI
  nova login [--server http://127.0.0.1:3000]
  nova bots
  nova chat <bot-id>
`);
}
