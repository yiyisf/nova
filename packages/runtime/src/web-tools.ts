import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

export type SearchProviderKind = "tavily" | "brave" | "searxng" | "none";

export type SearchConfig = {
  provider: SearchProviderKind;
  tavilyApiKey?: string;
  braveApiKey?: string;
  searxngBaseUrl?: string;
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchTavily(query: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
  });
  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (data.results ?? [])
    .map((item) => `- ${item.title ?? ""} (${item.url ?? ""})\n${item.content ?? ""}`)
    .join("\n\n");
}

async function searchBrave(query: string, apiKey: string): Promise<string> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  });
  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  return (data.web?.results ?? [])
    .map((item) => `- ${item.title ?? ""} (${item.url ?? ""})\n${item.description ?? ""}`)
    .join("\n\n");
}

async function searchSearxng(query: string, baseUrl: string): Promise<string> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (data.results ?? [])
    .slice(0, 5)
    .map((item) => `- ${item.title ?? ""} (${item.url ?? ""})\n${item.content ?? ""}`)
    .join("\n\n");
}

export function createWebSearchTool(config: SearchConfig) {
  return defineTool({
    name: "web_search",
    description: "Search the public web. Returns titles, URLs, and snippets.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    replay: "safe",
    execute: async ({ query }) => {
      if (config.provider === "none") {
        return {
          content: [
            {
              type: "text" as const,
              text: "Web search is not configured. Set WEB_SEARCH_PROVIDER to tavily, brave, or searxng.",
            },
          ],
        };
      }
      let text = "";
      if (config.provider === "tavily") {
        if (!config.tavilyApiKey) throw new Error("TAVILY_API_KEY is not set");
        text = await searchTavily(query, config.tavilyApiKey);
      } else if (config.provider === "brave") {
        if (!config.braveApiKey) throw new Error("BRAVE_SEARCH_API_KEY is not set");
        text = await searchBrave(query, config.braveApiKey);
      } else {
        if (!config.searxngBaseUrl) throw new Error("SEARXNG_BASE_URL is not set");
        text = await searchSearxng(query, config.searxngBaseUrl);
      }
      return { content: [{ type: "text" as const, text: text || "No results." }] };
    },
  });
}

export function createWebFetchTool() {
  return defineTool({
    name: "web_fetch",
    description: "Fetch a URL and return readable text (HTML tags stripped).",
    parameters: Type.Object({
      url: Type.String({ description: "HTTP or HTTPS URL" }),
    }),
    replay: "safe",
    execute: async ({ url }, api, context) => {
      if (!/^https?:\/\//i.test(url)) {
        throw new Error("Only http(s) URLs are allowed");
      }
      api.output(`fetching ${url}\n`);
      const response = await fetch(url, {
        signal: context.abortSignal,
        redirect: "follow",
        headers: { "user-agent": "Nova/0.1 (+https://github.com/yiyisf/nova)" },
      });
      const raw = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      const text = contentType.includes("html") ? htmlToText(raw) : raw;
      const clipped = text.length > 80_000 ? `${text.slice(0, 80_000)}\n…[truncated]` : text;
      return {
        content: [
          {
            type: "text" as const,
            text: `status ${response.status}\n\n${clipped}`,
          },
        ],
      };
    },
  });
}
