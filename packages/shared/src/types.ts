export type Protocol = "openai-compatible" | "anthropic";

export type ModelParams = {
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
};

export type PublicUser = {
  id: string;
  email: string;
  createdAt: string;
};

export type PublicBot = {
  id: string;
  userId: string;
  name: string;
  persona: string;
  modelConfigId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicConversation = {
  id: string;
  userId: string;
  botId: string;
  title: string;
  piConversationId: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicModelConfig = {
  id: string;
  userId: string;
  name: string;
  protocol: Protocol;
  baseUrl: string | null;
  modelId: string;
  providerId: string;
  hasApiKey: boolean;
  params: ModelParams;
  createdAt: string;
};

export type ApprovalStatus = "pending" | "approved" | "denied";

export type PublicApproval = {
  id: string;
  userId: string;
  conversationId: string;
  taskId: string;
  toolName: string;
  arguments: unknown;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
};

export type ChatEvent =
  | { type: "snapshot"; data: unknown }
  | { type: "agent"; events: unknown[] }
  | { type: "approval"; approval: PublicApproval }
  | { type: "error"; message: string }
  | { type: "done" };
