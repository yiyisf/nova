import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import {
  createRegistry,
  defineExtension,
  Harness,
  watchEvents,
  type Conversation,
  type ConversationId,
} from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { SandboxManager } from "@nova/sandbox";
import type { ModelParams } from "@nova/shared";
import { ApprovalBroker, createApprovalExtension } from "./approvals.ts";
import { createNovaModels, novaProviderId, type CustomModelInput } from "./models.ts";
import { createPersonaExtension } from "./persona.ts";
import { createUntrustedExtension } from "./untrusted.ts";
import { createWebFetchTool, createWebSearchTool, type SearchConfig } from "./web-tools.ts";

export type BotRuntimeConfig = {
  botId: string;
  botName: string;
  persona: string;
  model: { provider: string; modelId: string };
  params?: ModelParams;
};

export type UserModelConfig = CustomModelInput;

export type HarnessManagerOptions = {
  harnessDir: string;
  sandbox: SandboxManager;
  approvals: ApprovalBroker;
  search: SearchConfig;
  loadUserModels: (userId: string) => Promise<UserModelConfig[]>;
  loadBot: (userId: string, botId: string) => Promise<BotRuntimeConfig>;
};

type UserSession = {
  userId: string;
  harness: Harness;
  closing?: Promise<void>;
};

export class HarnessManager {
  private readonly sessions = new Map<string, Promise<UserSession>>();

  constructor(private readonly options: HarnessManagerOptions) {}

  async openUser(userId: string): Promise<Harness> {
    const session = await this.ensure(userId);
    return session.harness;
  }

  async resumeAll(userIds: string[]): Promise<void> {
    await Promise.all(userIds.map((id) => this.openUser(id)));
  }

  async createConversation(
    userId: string,
    botId: string,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<{ conversation: Conversation; harness: Harness }> {
    const harness = await this.openUser(userId);
    const bot = await this.options.loadBot(userId, botId);
    const cwd = this.options.sandbox.workspacePath(userId);
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: bot.model,
          instructions: bot.persona || undefined,
          cwd,
          thinkingLevel: bot.params?.thinkingLevel,
        },
      },
      context,
    );
    return { conversation, harness };
  }

  async conversation(
    userId: string,
    piConversationId: string,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<{ conversation: Conversation; harness: Harness }> {
    const harness = await this.openUser(userId);
    const conversation = await harness.conversation(toConversationId(piConversationId), context);
    if (!conversation) {
      throw new Error("Conversation not found in harness");
    }
    return { conversation, harness };
  }

  async submit(
    userId: string,
    piConversationId: string,
    content: string,
    requestId?: string,
    context: Context = BACKGROUND_CONTEXT,
  ) {
    const { conversation } = await this.conversation(userId, piConversationId, context);
    return conversation.submit(
      {
        type: "input",
        content,
        requestId,
        whenBusy: "steer",
      },
      context,
    );
  }

  async watch(userId: string, piConversationId: string, context: Context = BACKGROUND_CONTEXT) {
    const { harness } = await this.conversation(userId, piConversationId, context);
    return watchEvents(harness, toConversationId(piConversationId), context);
  }

  async closeUser(userId: string): Promise<void> {
    const pending = this.sessions.get(userId);
    if (!pending) return;
    const session = await pending;
    this.sessions.delete(userId);
    await session.harness.close(BACKGROUND_CONTEXT);
  }

  /** Close so the next open reloads model providers (e.g. after API key changes). */
  async invalidateUser(userId: string): Promise<void> {
    await this.closeUser(userId);
  }

  private ensure(userId: string): Promise<UserSession> {
    let pending = this.sessions.get(userId);
    if (!pending) {
      pending = this.open(userId);
      this.sessions.set(userId, pending);
    }
    return pending;
  }

  private async open(userId: string): Promise<UserSession> {
    await mkdir(this.options.harnessDir, { recursive: true });
    const file = join(this.options.harnessDir, `${userId}.sqlite`);
    const custom = await this.options.loadUserModels(userId);
    const models = createNovaModels({ custom });
    const registry = createRegistry();
    registry.install(CodingTools);
    registry.install(
      defineExtension({
        name: "nova-web",
        tools: [createWebSearchTool(this.options.search), createWebFetchTool()],
      }),
    );
    registry.install(createUntrustedExtension());
    registry.install(createApprovalExtension({ broker: this.options.approvals, userId }));
    registry.install(
      createPersonaExtension({
        botName: "Nova assistant",
        persona: "",
        userId,
      }),
    );

    const harness = await Harness.open(
      await openNodeSqliteStorage(file),
      {
        models,
        registry,
        env: async () => this.options.sandbox.envForUser(userId),
        settings: {
          progress: { partialIntervalMs: 80, outputIntervalMs: 80 },
        },
        onReport: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (/api[_-]?key|authorization|secret/i.test(message)) {
            console.error("[nova] harness error (redacted)");
            return;
          }
          console.error("[nova] harness:", message);
        },
      },
      BACKGROUND_CONTEXT,
    );
    harness.resume();
    return { userId, harness };
  }
}

export { novaProviderId };

function toConversationId(id: string): ConversationId {
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid Pi conversation id: ${id}`);
  }
  return numeric as ConversationId;
}
