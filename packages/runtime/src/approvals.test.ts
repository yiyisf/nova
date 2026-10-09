import type { ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ApprovalBroker, isDangerousTool, type ApprovalStore } from "./approvals.ts";
import type { PublicApproval } from "@nova/shared";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return {
    type: "toolCall",
    id: "call-1",
    name,
    arguments: args,
  } as ToolCall;
}

describe("dangerous tool detection", () => {
  it("flags destructive shell and file writes", () => {
    expect(isDangerousTool(call("write", { path: "a.txt" }))).toBe(true);
    expect(isDangerousTool(call("edit", { path: "a.txt" }))).toBe(true);
    expect(isDangerousTool(call("bash", { command: "rm -rf /tmp/x" }))).toBe(true);
    expect(isDangerousTool(call("bash", { command: "ls -la" }))).toBe(false);
    expect(isDangerousTool(call("read", { path: "a.txt" }))).toBe(false);
    expect(isDangerousTool(call("web_search", { query: "hi" }))).toBe(false);
  });
});

describe("ApprovalBroker", () => {
  it("resolves a pending request when decided", async () => {
    const rows = new Map<string, PublicApproval>();
    const store: ApprovalStore = {
      async findByTaskId(_userId, taskId) {
        return [...rows.values()].find((row) => row.taskId === taskId);
      },
      async create(request) {
        const row: PublicApproval = {
          id: "appr-1",
          userId: request.userId,
          conversationId: "conv-1",
          taskId: request.taskId,
          toolName: request.toolName,
          arguments: request.arguments,
          status: "pending",
          createdAt: new Date().toISOString(),
          decidedAt: null,
        };
        rows.set(row.id, row);
        return row;
      },
      async decide(_userId, id, status) {
        const row = rows.get(id);
        if (!row) return undefined;
        const next = { ...row, status, decidedAt: new Date().toISOString() };
        rows.set(id, next);
        return next;
      },
      async get(_userId, id) {
        return rows.get(id);
      },
    };
    const broker = new ApprovalBroker(store);
    const pending = broker.request({
      userId: "u1",
      piConversationId: "pi-c1",
      taskId: "t1",
      toolName: "bash",
      arguments: { command: "rm file" },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await broker.decide("u1", "appr-1", "approved");
    await expect(pending).resolves.toBe("approved");
  });
});
