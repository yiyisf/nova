import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Bot, type ModelConfig } from "../api.ts";

export function HomePage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [botName, setBotName] = useState("助手");
  const [persona, setPersona] = useState("");
  const [botModel, setBotModel] = useState<string>("");
  const [modelName, setModelName] = useState("OpenAI 兼容");
  const [protocol, setProtocol] = useState<ModelConfig["protocol"]>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [modelId, setModelId] = useState("gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");

  async function reload() {
    const [botData, modelData] = await Promise.all([api.bots(), api.models()]);
    setBots(botData.bots);
    setModels(modelData.models);
    if (!botModel && modelData.models[0]) setBotModel(modelData.models[0].id);
  }

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : "载入失败"));
  }, []);

  return (
    <div className="grid">
      <section className="panel stack">
        <h2>机器人</h2>
        <p className="muted">每个机器人有独立的人设、模型与对话。</p>
        {error ? <p className="error">{error}</p> : null}
        <ul className="list">
          {bots.map((bot) => (
            <li key={bot.id}>
              <div>
                <strong>{bot.name}</strong>
                <div className="muted">{bot.persona || "默认人设"}</div>
              </div>
              <Link to={`/bots/${bot.id}`}>打开</Link>
            </li>
          ))}
        </ul>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void api
              .createBot({ name: botName, persona, modelConfigId: botModel || null })
              .then(reload)
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "创建失败"));
          }}
        >
          <label>
            名称
            <input value={botName} onChange={(e) => setBotName(e.target.value)} required />
          </label>
          <label>
            人设
            <textarea value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="你是一个简洁的助手。" />
          </label>
          <label>
            模型
            <select value={botModel} onChange={(e) => setBotModel(e.target.value)}>
              <option value="">（未选择）</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.modelId}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">新建机器人</button>
        </form>
      </section>

      <section className="panel stack">
        <h2>模型配置</h2>
        <p className="muted">API 密钥加密存储，不会进入模型上下文或日志。</p>
        <ul className="list">
          {models.map((model) => (
            <li key={model.id}>
              <div>
                <strong>{model.name}</strong>
                <div className="muted">
                  {model.protocol} · {model.modelId}
                  {model.hasApiKey ? " · 已保存密钥" : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void api
              .createModel({
                name: modelName,
                protocol,
                baseUrl: protocol === "openai-compatible" ? baseUrl : undefined,
                modelId,
                apiKey: apiKey || undefined,
              })
              .then(() => {
                setApiKey("");
                return reload();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "保存失败"));
          }}
        >
          <label>
            名称
            <input value={modelName} onChange={(e) => setModelName(e.target.value)} required />
          </label>
          <label>
            协议
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as ModelConfig["protocol"])}
            >
              <option value="openai-compatible">OpenAI 兼容（DeepSeek / Qwen / Ollama）</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          {protocol === "openai-compatible" ? (
            <label>
              Base URL
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
            </label>
          ) : null}
          <label>
            模型 ID
            <input value={modelId} onChange={(e) => setModelId(e.target.value)} required />
          </label>
          <label>
            API Key
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder="不会再次显示"
              autoComplete="off"
            />
          </label>
          <button type="submit">保存模型</button>
        </form>
      </section>
    </div>
  );
}
