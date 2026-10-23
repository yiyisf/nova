# Nova 设计文档

## 1. 产品定位

Nova 是开源、服务端、多用户的个人 AI 助手平台。许多用户共享一台服务器；每位用户拥有多个 Bot。每个 Bot 有自己的人设、记忆、技能、定时例程，并能在**按用户隔离**的工作区里跑命令、处理文件、搜索/抓取网页、驱动浏览器（后续阶段）。长任务在后台执行并回报。

Phase 1 只覆盖单机部署的地基：账号、多租户、Pi Durable 运行时、模型配置、基础工具、审批机制、Docker 沙箱、API、CLI 与最小 Web 对话页。

## 2. 总体架构

```
          Web / CLI
              │  REST + SSE（Cookie 会话）
              ▼
           server          worker（Phase 3）
         HTTP / 鉴权 / RLS
              │
              ▼
           runtime  ── Pi Durable Harness（每用户一份存储）
              │
              ├── sandbox ExecutionEnv（每用户 Docker 或本地回退）
              ├── extensions：coding tools / web / 审批 / 不可信标记
              └── pi-ai providers（OpenAI 兼容 + Anthropic + 用户自定义）

存储：
  PostgreSQL  业务表（users, bots, conversations, model_configs, approvals）
  SQLite      Pi Durable 会话（HARNESS_DIR/{userId}.sqlite）
  Redis       预留给队列 / pubsub
  磁盘/S3     工作区文件（Phase 1 为本地卷）
```

Monorepo（pnpm workspaces）：

| 包 | 职责 |
| --- | --- |
| `@nova/shared` | 类型、AES-GCM、环境变量、不可信标记 |
| `@nova/sandbox` | `ExecutionEnv`：Docker + 本地回退 |
| `@nova/runtime` | Harness 管理、扩展、模型装配 |
| `@nova/server` | Hono API、Drizzle、RLS |
| `@nova/web` | Vite + React 最小对话 UI |
| `@nova/cli` | `nova login` / `bots` / `chat` |
| `@nova/worker` | Phase 3 占位 |

## 3. 多租户与安全

- 每张业务表带 `user_id`；应用查询始终按当前用户过滤。
- PostgreSQL RLS + `FORCE ROW LEVEL SECURITY`，会话内 `set_config('app.user_id', …, true)`。
- 密码：argon2id。会话：HttpOnly Cookie，token 只存 SHA-256。
- 模型 API Key：AES-256-GCM，主密钥 `NOVA_MASTER_KEY`；日志脱敏。
- 工具输出包在 `<untrusted-data>` 中，降低提示注入。
- 工作区路径做前缀约束，禁止 `..` 逃逸。

## 4. Pi Durable 集成

Nova **不实现**自己的 agent loop 或模型层。

- `Harness.open(storage, { models, registry, env }, context)`
- 每用户 `openNodeSqliteStorage(HARNESS_DIR/{userId}.sqlite)`（官方 SQLite 后端）。业务元数据在 Postgres。选择 SQLite 而不是自研 Postgres storage adapter，是因为 Durable 的 `Storage` 接口覆盖 session / documents / tasks / watches，官方实现约数千行；Phase 1 用「每租户一份存储」满足崩溃恢复语义。
- 启动后 `harness.resume()` 继续中断的 generation / tool 任务。
- 流式：`watchEvents(harness, conversationId)` → SSE。
- 扩展：`coding-tools`（read/write/edit/bash）、`nova-web`、`nova-approvals`、`nova-untrusted`、`nova-persona`。
- `replay: "safe"` 仅用于幂等工具（read / search / fetch）。bash / write / edit 默认 unsafe，崩溃后模型会看到 interrupted。
- 审批：`hook(ToolTask, { beforeTool })` + `api.memo`；决定写入 memo，重启不会重复询问。
- 自定义模型：`createProvider` + `openAICompletionsApi()` / `anthropicMessagesApi()`，provider id 为 `nova-{configId}`。

与早期文档预期的差异见文末。

## 5. 沙箱

`ExecutionEnv` = `FileSystem & Shell`。

- **Docker（默认生产）**：每用户容器，内存/CPU/pids 限制，工作区 bind mount。文件工具走挂载卷（与容器内同一路径）；`exec` 通过 `docker exec` 进入容器。
- **local（开发）**：`NodeExecutionEnv` 直接跑在主机目录上，启动时打印 UNSAFE 警告。

## 6. API（Phase 1）

- `POST /api/auth/signup|login|logout`，`GET /api/auth/me`
- `CRUD /api/bots`，`CRUD /api/models`
- `POST /api/bots/:id/conversations`，`POST /api/conversations/:id/messages`
- `GET /api/conversations/:id/events`（SSE：`snapshot` / `agent` / `approval`）
- `POST /api/approvals/:id/approve|deny`
- `GET|PUT /api/workspace`（当前用户工作区）

## 7. 五阶段路线图

### Phase 1 — 地基（本仓库）

账号、多租户、RLS、Pi Durable、模型配置、基础工具、审批骨架、Docker 沙箱、REST/SSE、CLI、最小 Web、Compose。

### Phase 2 — 记忆、技能、加固

长期记忆（profile / log / notes，pgvector，用户共享 vs Bot 私有）、Bot 可自行保存的 Markdown 技能、审批策略硬化、密钥存储永不暴露给模型、MCP 连接器（OAuth）。

### Phase 3 — 例程与协作

Cron 例程、事件/Webhook 触发、后台 sub-agent（steer/stop）、Bot 之间消息。`packages/worker` 在此阶段落地。

### Phase 4 — 完整 Web 与浏览器

完整 UI 设计（气质与 token 见第 10 节）、Playwright 浏览器、可查看的沙箱桌面。

### Phase 5 — 对外通道与运维

Slack / Telegram / 飞书、用量与配额、管理后台、Kubernetes 部署、出站消息先拟草稿、不可逆操作审批。

## 8. Phase 1 已知限制

- 单机；一个进程打开一份用户 Harness（Pi Durable：同一 storage 同时只能被一个进程持有）。
- 没有对象存储；工作区在本地磁盘。
- 没有完整的用量、通道、浏览器、长期记忆。
- 危险命令检测是启发式的（`rm` / `sudo` / 重定向等）；后续用策略引擎替换。
- 本地沙箱不安全。
- Pi Durable 与 pi-ai 标为 experimental，已钉死 `1.1.0`。
- pi-durable 声明 `engines.node >= 22.19.0`；开发镜像可能是 22.14，安装时关闭了 `engine-strict`。

## 9. 与 Pi Durable 文档预期的差异

1. **包名**：`@earendil-works/pi-durable`、`@earendil-works/pi-ai`、`@earendil-works/chord`（不是 `@pi/*`）。当前钉 `1.1.0`。
2. **存储**：未实现 Postgres `Storage` adapter，使用官方 `openNodeSqliteStorage` 做每用户持久化。Postgres 只存业务数据。
3. **CodingTools** 扩展名为 `coding-tools`；内置工具是 `read` / `write` / `edit` / `bash`。
4. **`beforeTool`** 返回 `{ block?: string; arguments?: object }`，不是布尔值；持久化决定靠 `api.memo`。
5. **自定义 OpenAI 兼容端** 需要 `createProvider` + `openAICompletionsApi()`，并常设 `compat.supportsDeveloperRole: false`。
6. **`ExecutionEnv`** 是完整的文件系统 + `exec(string | argv)`，不是一个简单的 `runCommand`。
7. **流式 UI** 的一等 API 是 `viewState()` / `watch()`；`watchEvents()` 仍标 experimental，但更接近对话 UI。
8. **`Harness.open` 的 `env`** 签名为 `(target: { conversationId, cwd, read }, context) => ExecutionEnv`。
9. **ConversationId** 在运行时当字符串使用并写入 `conversations.pi_conversation_id`。

## 10. UI 气质与 Non-goals

### 10.1 已确认方向（2026-10-23）

- **主气质**：纸质工作台（安静书桌：像笔记与邮件，不像聊天机器人）。
- **主色**：赭橙 `#C45C26`（仅用于链接 / 主按钮 / 焦点）。
- **正文**：近墨 `#1C1917`。
- **背景**：暖纸 `#F7F4EF`；浅灰底 `#EEEAE3`；卡片 `#FFFEFB` + 1px `#E7E2D9`。
- **语义色**：成功 `#2F6F4E`；警告 `#A65D2E`；危险 `#9B2C2C`（失败才醒目）。
- **字体**：中文标题 Source Han Serif SC / Noto Serif SC；正文系统 UI（PingFang / Noto Sans SC），行高约 1.7；代码 JetBrains Mono / ui-monospace。
- **尺度**：卡片圆角 6px；按钮 4px；无毛玻璃；阴影仅 `0 1px 2px rgba(28,25,23,0.06)`。
- **对话**：默认文档流、无聊天气泡；用户句字重 500，助手句 400 + 左侧 2px 浅分隔。
- **Bot**：名牌（名字 + 一行职责）；无发光环、无立绘主视觉。
- **审批 / 外发草稿**：一等公民整卡；外发不可逆前必须经草稿确认页。

可选模式（非第三套品牌）：
- **工具台**：暗色 / 高密度专注模式，同一信息架构换材质。
- **书房**：记忆 / 长文 / 例程回看的阅读版式。

### 10.2 UI Non-goals

- 不做 ChatGPT / Open WebUI / LibreChat / Lobe 式「气泡军备」与宇宙渐变英雄区。
- 不做紫靛渐变、发光球、星尘、霓虹描边、赛博网格、呼吸动画堆砌。
- 不做侧栏模型厂商标墙与彩虹 provider 徽章。
- 不做吉祥物 / 二次元立绘当主视觉。
- 不做 Dify 式工作流画布（产品 Non-goal，与 UI 一致）。
- 不做以 IM 通道覆盖率为优先的视觉与导航（通道在 Phase 5，不驱动主 UI）。
- 不自研第二套 agent loop 的「控制台皮肤」去模仿 IDE。

### 10.3 关键画面（线框意图）

1. **Bot 列表**：顶栏 + 左侧名牌列表 + 右侧选中 Bot 摘要；主按钮「打开对话」。
2. **对话**：窄侧栏切 Bot；主栏文档流；工具/审批整卡嵌在流中；输入区克制。
3. **外发草稿**：抬头（通道/收件人/待确认）+ 正文预览为主 + 发送（赭橙）/ 修改 / 丢弃。

Phase 4 实现 Web 时以上述三画面与 token 为准。
