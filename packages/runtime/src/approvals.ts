import { EventEmitter } from "node:events";
import type { ToolCall } from "@earendil-works/pi-ai";
import { defineExtension, hook, ToolTask } from "@earendil-works/pi-durable";
import type { PublicApproval } from "@nova/shared";

export type ApprovalDecision = "approved" | "denied";

export type ApprovalRequest = {
  userId: string;
  piConversationId: string;
  taskId: string;
  toolName: string;
  arguments: unknown;
};

export type ApprovalStore = {
  findByTaskId(userId: string, taskId: string): Promise<PublicApproval | undefined>;
  create(request: ApprovalRequest): Promise<PublicApproval>;
  decide(userId: string, id: string, status: ApprovalDecision): Promise<PublicApproval | undefined>;
  get(userId: string, id: string): Promise<PublicApproval | undefined>;
};

const DESTRUCTIVE_BASH =
  /\b(rm|sudo|chmod|chown|dd|mkfs|shutdown|reboot|kill|pkill|mv|truncate|tee|mkfs\.\w+)\b|^\s*:>|>>|wget\s+|curl\s+[^\n]*\|\s*(ba)?sh/i;

export function isDangerousTool(call: ToolCall): boolean {
  if (call.name === "write" || call.name === "edit") return true;
  if (call.name === "bash") {
    const command = typeof call.arguments.command === "string" ? call.arguments.command : "";
    return DESTRUCTIVE_BASH.test(command);
  }
  return false;
}

export class ApprovalBroker extends EventEmitter {
  constructor(private readonly store: ApprovalStore) {
    super();
    this.setMaxListeners(200);
  }

  async request(info: ApprovalRequest): Promise<ApprovalDecision> {
    const existing = await this.store.findByTaskId(info.userId, info.taskId);
    if (existing && existing.status !== "pending") {
      return existing.status;
    }
    const row = existing ?? (await this.store.create(info));
    if (!existing) {
      this.emit("requested", row);
    }
    if (row.status !== "pending") return row.status;
    return this.wait(row.id);
  }

  private wait(id: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const event = `decision:${id}`;
      const onDecision = (status: ApprovalDecision) => {
        this.off(event, onDecision);
        resolve(status);
      };
      this.on(event, onDecision);
    });
  }

  async decide(userId: string, id: string, status: ApprovalDecision): Promise<PublicApproval | undefined> {
    const row = await this.store.decide(userId, id, status);
    if (row) {
      this.emit(`decision:${id}`, status);
      this.emit("decided", row);
    }
    return row;
  }
}

export function createApprovalExtension(params: {
  broker: ApprovalBroker;
  userId: string;
}) {
  return defineExtension({
    name: "nova-approvals",
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          if (!isDangerousTool(call)) return undefined;
          const memoKey = "nova.approval";
          let stored = await api.memo<{ status: ApprovalDecision }>(memoKey, context);
          if (!stored) {
            const decision = await params.broker.request({
              userId: params.userId,
              piConversationId: String(api.conversationId),
              taskId: String(api.taskId),
              toolName: call.name,
              arguments: call.arguments,
            });
            stored = await api.memo(memoKey, { status: decision }, context);
          }
          if (stored.status === "approved") return undefined;
          return { block: "The user denied this tool call." };
        },
      }),
    ],
  });
}
