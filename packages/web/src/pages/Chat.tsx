import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Approval, type Bot, type Conversation } from "../api.ts";

type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; args: unknown; output: string }
  | { kind: "approval"; approval: Approval };

type AgentEvent = {
  type: string;
  message?: { role?: string; content?: unknown };
  entry?: { id?: number; kind?: string; model?: { role?: string; content?: unknown }[] };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  output?: { append?: string; set?: string };
  events?: unknown;
};

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const rec = block as { type?: string; text?: string; name?: string };
      if (rec.type === "text" && rec.text) return rec.text;
      if (rec.type === "toolCall") return "";
      return rec.text ?? "";
    })
    .filter(Boolean)
    .join("");
}

function applySnapshot(snapshot: { entries?: { id: number; kind: string; model?: { role?: string; content?: unknown }[] }[] }): ChatItem[] {
  const items: ChatItem[] = [];
  for (const entry of snapshot.entries ?? []) {
    const message = entry.model?.[0];
    if (!message) continue;
    if (entry.kind === "pi.user" || message.role === "user") {
      items.push({ kind: "user", id: String(entry.id), text: textFromContent(message.content) });
    } else if (entry.kind === "pi.assistant" || message.role === "assistant") {
      items.push({ kind: "assistant", id: String(entry.id), text: textFromContent(message.content) });
      const content = Array.isArray(message.content) ? message.content : [];
      for (const block of content) {
        const rec = block as { type?: string; id?: string; name?: string; arguments?: unknown };
        if (rec.type === "toolCall") {
          items.push({
            kind: "tool",
            id: rec.id ?? `${entry.id}-tool`,
            name: rec.name ?? "tool",
            args: rec.arguments,
            output: "",
          });
        }
      }
    } else if (entry.kind === "pi.tool-result" || message.role === "toolResult") {
      const rec = message as { toolCallId?: string; content?: unknown };
      const existing = items.find((item) => item.kind === "tool" && item.id === rec.toolCallId);
      if (existing && existing.kind === "tool") {
        existing.output = textFromContent(rec.content);
      }
    }
  }
  return items;
}

export function ChatPage() {
  const { botId } = useParams();
  const [bot, setBot] = useState<Bot | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const title = useMemo(() => bot?.name ?? "对话", [bot]);

  useEffect(() => {
    if (!botId) return;
    api
      .bots()
      .then((data) => setBot(data.bots.find((item) => item.id === botId) ?? null));
    api.conversations(botId).then((data) => {
      setConversations(data.conversations);
      if (data.conversations[0]) setActiveId(data.conversations[0].id);
    });
  }, [botId]);

  useEffect(() => {
    sourceRef.current?.close();
    if (!activeId) return;
    const source = new EventSource(`/api/conversations/${activeId}/events`, { withCredentials: true });
    sourceRef.current = source;
    source.addEventListener("snapshot", (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as Parameters<typeof applySnapshot>[0];
      setItems(applySnapshot(snapshot));
    });
    source.addEventListener("agent", (event) => {
      const events = JSON.parse((event as MessageEvent).data) as AgentEvent[];
      setItems((current) => applyEvents(current, events));
    });
    source.addEventListener("approval", (event) => {
      const approval = JSON.parse((event as MessageEvent).data) as Approval;
      setItems((current) => {
        const without = current.filter(
          (item) => !(item.kind === "approval" && item.approval.id === approval.id),
        );
        if (approval.status === "pending") return [...without, { kind: "approval", approval }];
        return without;
      });
    });
    source.onerror = () => setError("实时连接中断，正在重试…");
    return () => source.close();
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items]);

  async function ensureConversation(): Promise<string> {
    if (activeId) return activeId;
    if (!botId) throw new Error("missing bot");
    const created = await api.createConversation(botId);
    setConversations((current) => [created.conversation, ...current]);
    setActiveId(created.conversation.id);
    return created.conversation.id;
  }

  async function send() {
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      const id = await ensureConversation();
      setDraft("");
      await api.sendMessage(id, content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <Link to="/">← 机器人</Link>
        <h2 style={{ margin: 0 }}>{title}</h2>
      </div>
      <div className="chat-layout">
        <aside className="panel">
          <h2>会话</h2>
          <ul className="list">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setActiveId(conversation.id)}
                >
                  {conversation.title}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (!botId) return;
              void api.createConversation(botId).then((data) => {
                setConversations((current) => [data.conversation, ...current]);
                setActiveId(data.conversation.id);
                setItems([]);
              });
            }}
          >
            新会话
          </button>
        </aside>
        <section className="panel">
          <div className="messages">
            {items.map((item, index) => (
              <ChatItemView
                key={`${item.kind}-${"id" in item ? item.id : item.approval.id}-${index}`}
                item={item}
              />
            ))}
            <div ref={bottomRef} />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="写一条消息。危险的文件/命令写入会先征求你的同意。"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button type="submit" disabled={busy}>
              发送
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function applyEvents(current: ChatItem[], events: AgentEvent[]): ChatItem[] {
  const next = [...current];
  for (const event of events) {
    if (event.type === "message_start" && event.message?.role === "assistant") {
      next.push({ kind: "assistant", id: `live-${next.length}`, text: textFromContent(event.message.content) });
    } else if (event.type === "message_update") {
      const last = [...next].reverse().find((item) => item.kind === "assistant");
      if (last && last.kind === "assistant" && event.message) {
        last.text = textFromContent(event.message.content);
      } else if (last && last.kind === "assistant") {
        const rec = event as { changes?: { type: string; delta?: string }[] };
        for (const change of rec.changes ?? []) {
          if (change.type === "text_delta" && change.delta) last.text += change.delta;
        }
      }
    } else if (event.type === "message_end" && event.entry?.model?.[0]?.role === "assistant") {
      const last = [...next].reverse().find((item) => item.kind === "assistant");
      if (last && last.kind === "assistant") {
        last.id = String(event.entry.id ?? last.id);
        last.text = textFromContent(event.entry.model[0].content);
      }
    } else if (event.type === "tool_execution_start") {
      next.push({
        kind: "tool",
        id: event.toolCallId ?? `tool-${next.length}`,
        name: event.toolName ?? "tool",
        args: event.args,
        output: "",
      });
    } else if (event.type === "tool_execution_update") {
      const tool = next.find((item) => item.kind === "tool" && item.id === event.toolCallId);
      if (tool && tool.kind === "tool") {
        if (event.output && "set" in event.output && event.output.set !== undefined) tool.output = event.output.set;
        if (event.output && "append" in event.output && event.output.append) tool.output += event.output.append;
      }
    }
  }
  return next;
}

function ChatItemView({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="bubble user">
        <div className="who">你</div>
        <div className="body">{item.text}</div>
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="bubble">
        <div className="who">助手</div>
        <div className="body">{item.text}</div>
      </div>
    );
  }
  if (item.kind === "tool") {
    return (
      <details className="tool-row">
        <summary>
          工具 · {item.name}
        </summary>
        <pre>{JSON.stringify(item.args, null, 2)}</pre>
        {item.output ? <pre>{item.output}</pre> : null}
      </details>
    );
  }
  return (
    <div className="approval">
      <strong>需要批准：{item.approval.toolName}</strong>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
        {JSON.stringify(item.approval.arguments, null, 2)}
      </pre>
      {item.approval.status === "pending" ? (
        <div className="row">
          <button type="button" onClick={() => void api.approve(item.approval.id)}>
            批准
          </button>
          <button type="button" className="danger" onClick={() => void api.deny(item.approval.id)}>
            拒绝
          </button>
        </div>
      ) : (
        <span className="muted">{item.approval.status}</span>
      )}
    </div>
  );
}
