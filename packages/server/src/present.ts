import { novaProviderId } from "@nova/runtime";
import type {
  PublicApproval,
  PublicBot,
  PublicConversation,
  PublicModelConfig,
  PublicUser,
} from "@nova/shared";
import type { approvals, bots, conversations, modelConfigs, users } from "./db/schema.ts";

export function presentUser(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}

export function presentBot(row: typeof bots.$inferSelect): PublicBot {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    persona: row.persona,
    modelConfigId: row.modelConfigId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function presentConversation(row: typeof conversations.$inferSelect): PublicConversation {
  return {
    id: row.id,
    userId: row.userId,
    botId: row.botId,
    title: row.title,
    piConversationId: row.piConversationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function presentModelConfig(row: typeof modelConfigs.$inferSelect): PublicModelConfig {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    providerId: novaProviderId(row.id),
    hasApiKey: Boolean(row.encryptedApiKey),
    params: row.params ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

export function presentApproval(row: typeof approvals.$inferSelect): PublicApproval {
  return {
    id: row.id,
    userId: row.userId,
    conversationId: row.conversationId,
    taskId: row.taskId,
    toolName: row.toolName,
    arguments: row.arguments,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}
