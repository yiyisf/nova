import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import { defineExtension, hook, ToolTask } from "@earendil-works/pi-durable";
import { wrapUntrusted } from "@nova/shared";

export function createUntrustedExtension() {
  return defineExtension({
    name: "nova-untrusted",
    hooks: [
      hook(ToolTask, {
        afterTool: (_call, result): ToolExecutionResult => {
          if (!result.content) return result;
          return {
            ...result,
            content: result.content.map((block) => {
              if (block.type === "text") {
                return { ...block, type: "text" as const, text: wrapUntrusted(block.text) };
              }
              return block;
            }),
          };
        },
      }),
    ],
  });
}
