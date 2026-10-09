# Nova

自托管、多用户的个人 AI 助手平台。一台服务器上许多用户共用同一套服务；每位用户可以创建多个 Bot，每个 Bot 有独立的人设、模型、记忆（后续阶段）与工具，并在隔离的工作区里执行命令、读写文件、搜索与抓取网页。

Phase 1（当前）提供：账号与多租户、Pi Durable 运行时、加密的模型配置、基础工具与审批、每用户沙箱、REST + SSE、终端 CLI，以及一套克制的 Web 对话界面。

## 快速开始（Docker Compose）

需要：Docker、Docker Compose，以及 Node.js 22+（仅本地开发时需要）。

```bash
cp .env.example .env
# 请把 NOVA_MASTER_KEY / NOVA_SESSION_SECRET 换成足够长的随机值

docker compose up --build
```

- Web：http://localhost:8080
- API：http://localhost:3000

打开 Web 后注册账号 → 添加模型（OpenAI 兼容或 Anthropic）→ 创建 Bot → 开始对话。

可选种子账号：

```bash
docker compose exec server pnpm --filter @nova/server seed
# demo@nova.local / novademo1
```

`SANDBOX_MODE=docker`（compose 默认）会为每个用户启动隔离容器。工作区目录通过 bind mount 挂到 `./data/workspaces`，并把该**宿主机绝对路径**传给 `SANDBOX_HOST_WORKSPACE_DIR`（compose 使用 `COMPOSE_PROJECT_DIR`），这样 API 容器通过 Docker socket 创建的沙箱能看到同一份文件。若本机没有可用的 Docker socket，可设 `SANDBOX_MODE=local`（**不安全**：工具在主机进程里执行，仅供开发）。

## 配置模型

在 Web「模型配置」中填写：

| 协议 | 适用 | 示例 |
| --- | --- | --- |
| `openai-compatible` | OpenAI、DeepSeek、通义/Qwen、Ollama、vLLM | Base URL `https://api.deepseek.com/v1`，模型 ID `deepseek-chat` |
| `anthropic` | Anthropic Messages | 模型 ID `claude-sonnet-4-5` |

API Key 使用 AES-256-GCM 加密后落库，**不会**写入日志或送进模型上下文。管理员默认值可通过环境变量 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`DEFAULT_MODEL_PROVIDER`、`DEFAULT_MODEL_ID` 提供。

可选联网搜索：`WEB_SEARCH_PROVIDER=tavily|brave|searxng`。

## 本地开发

```bash
pnpm install
cp .env.example .env
# 启动 Postgres（可用 compose 只起数据库）
docker compose up -d postgres redis
pnpm db:migrate
pnpm dev:server   # http://127.0.0.1:3000
pnpm dev:web      # http://localhost:5173，/api 代理到 3000
```

CLI：

```bash
pnpm --filter @nova/cli start login -- --server http://127.0.0.1:3000
pnpm --filter @nova/cli start bots
pnpm --filter @nova/cli start chat <bot-id>
```

检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## 架构要点

- **业务数据**：PostgreSQL（`user_id` + Row-Level Security）。
- **对话耐久性**：每位用户一份 Pi Durable SQLite 存储（`HARNESS_DIR/{userId}.sqlite`）。进程崩溃后 `Harness.open` + `resume()` 会接上未完成的任务。
- **运行时**：不自研 agent loop，全部走 [`@earendil-works/pi-durable`](https://earendil.com/posts/pi-durable/) 与 `pi-ai`。
- **沙箱**：实现 Pi Durable 的 `ExecutionEnv`；文件走绑定卷，shell 在用户容器内 `docker exec`。
- **审批**：`beforeTool` 钩子 + `api.memo`，危险的写入/`rm` 等会暂停并在 UI 中弹出批准卡片。

完整设计与五阶段路线图见 [docs/design.md](docs/design.md)。

## 许可证

MIT
