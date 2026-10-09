import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { Protocol } from "@nova/shared";

export type CustomModelInput = {
  providerId: string;
  name: string;
  protocol: Protocol;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  contextWindow?: number;
  maxTokens?: number;
};

function openaiCompatModel(input: CustomModelInput): Model<"openai-completions"> {
  return {
    id: input.modelId,
    name: input.name,
    api: "openai-completions",
    provider: input.providerId,
    baseUrl: input.baseUrl ?? "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: input.contextWindow ?? 128_000,
    maxTokens: input.maxTokens ?? 8192,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

function anthropicModel(input: CustomModelInput): Model<"anthropic-messages"> {
  return {
    id: input.modelId,
    name: input.name,
    api: "anthropic-messages",
    provider: input.providerId,
    baseUrl: input.baseUrl ?? "https://api.anthropic.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: input.contextWindow ?? 200_000,
    maxTokens: input.maxTokens ?? 8192,
  };
}

export function createNovaModels(options: {
  custom: CustomModelInput[];
  includeBuiltins?: boolean;
}) {
  const models = createModels();
  if (options.includeBuiltins !== false) {
    models.setProvider(openaiProvider());
    models.setProvider(anthropicProvider());
  }
  for (const custom of options.custom) {
    const apiKey = custom.apiKey;
    if (custom.protocol === "anthropic") {
      models.setProvider(
        createProvider({
          id: custom.providerId,
          name: custom.name,
          baseUrl: custom.baseUrl ?? "https://api.anthropic.com",
          auth: {
            apiKey: {
              name: custom.name,
              resolve: async () =>
                apiKey ? { auth: { apiKey }, source: "nova-encrypted-store" } : undefined,
            },
          },
          models: [anthropicModel(custom)],
          api: anthropicMessagesApi(),
        }),
      );
    } else {
      models.setProvider(
        createProvider({
          id: custom.providerId,
          name: custom.name,
          baseUrl: custom.baseUrl ?? "https://api.openai.com/v1",
          auth: {
            apiKey: {
              name: custom.name,
              resolve: async () =>
                apiKey ? { auth: { apiKey }, source: "nova-encrypted-store" } : { auth: {} },
            },
          },
          models: [openaiCompatModel(custom)],
          api: openAICompletionsApi(),
        }),
      );
    }
  }
  return models;
}

export function novaProviderId(modelConfigId: string): string {
  return `nova-${modelConfigId}`;
}
