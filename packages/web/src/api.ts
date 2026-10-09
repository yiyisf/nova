export type User = { id: string; email: string; createdAt: string };
export type Bot = {
  id: string;
  name: string;
  persona: string;
  modelConfigId: string | null;
  createdAt: string;
};
export type ModelConfig = {
  id: string;
  name: string;
  protocol: "openai-compatible" | "anthropic";
  baseUrl: string | null;
  modelId: string;
  hasApiKey: boolean;
};
export type Conversation = { id: string; botId: string; title: string; createdAt: string };
export type Approval = {
  id: string;
  conversationId: string;
  toolName: string;
  arguments: unknown;
  status: "pending" | "approved" | "denied";
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  signup: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  bots: () => request<{ bots: Bot[] }>("/api/bots"),
  createBot: (body: { name: string; persona: string; modelConfigId: string | null }) =>
    request<{ bot: Bot }>("/api/bots", { method: "POST", body: JSON.stringify(body) }),
  updateBot: (id: string, body: Partial<{ name: string; persona: string; modelConfigId: string | null }>) =>
    request<{ bot: Bot }>(`/api/bots/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteBot: (id: string) => request<{ ok: boolean }>(`/api/bots/${id}`, { method: "DELETE" }),
  models: () => request<{ models: ModelConfig[] }>("/api/models"),
  createModel: (body: {
    name: string;
    protocol: ModelConfig["protocol"];
    baseUrl?: string;
    modelId: string;
    apiKey?: string;
  }) => request<{ model: ModelConfig }>("/api/models", { method: "POST", body: JSON.stringify(body) }),
  conversations: (botId: string) => request<{ conversations: Conversation[] }>(`/api/bots/${botId}/conversations`),
  createConversation: (botId: string) =>
    request<{ conversation: Conversation }>(`/api/bots/${botId}/conversations`, { method: "POST" }),
  sendMessage: (conversationId: string, content: string) =>
    request<{ submissionId: number }>(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  approve: (id: string) => request<{ approval: Approval }>(`/api/approvals/${id}/approve`, { method: "POST" }),
  deny: (id: string) => request<{ approval: Approval }>(`/api/approvals/${id}/deny`, { method: "POST" }),
};
