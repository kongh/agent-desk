# AgentDesk 智能体工作台阶段总结

## 1. 项目目标

我们要构建 AgentDesk 智能体工作台，不是从零实现 agent runtime，而是复用 OpenCode 的运行能力。

当前产品方向是业务任务型 agent，类似：

- 通用业务任务助手
- 深度调研智能体
- PPT 助手
- 技能生成器

MVP 先聚焦“深度调研智能体”：用户在 Web 页面输入调研目标，系统创建任务工作区，调用 OpenCode 执行任务，并沉淀来源、笔记和最终报告。

## 2. 当前技术路线

我们选定的主线是：

```text
Web UI
  -> API Server
      -> OpenCode SDK Runner
          -> opencode serve
          -> session / prompt / event stream
      -> Task Workspace
          -> input / sources / notes / output / logs
```

OpenCode 在这里不是作为“代码助手产品”直接暴露给用户，而是作为底层 agent runtime。我们在外层包了一层业务产品 UI、任务模型、工作区模型和事件流。

## 3. 已完成内容

### 3.1 项目结构

当前目录结构已经按产品、实现、运行环境分层：

```text
docs/                     产品、PRD、调研、架构、ADR
apps/web/                 Web 前端
apps/api/                 后端 API
packages/opencode-runner/ OpenCode runner 封装
packages/agent-workspace/ 任务工作区能力
agents/opencode/          OpenCode agent profile / command / tool 资产
infra/                    Docker、Compose、Nginx、环境脚本
config/                   环境变量、模型、权限配置
workspaces/               本地任务工作区
```

### 3.2 MVP Web 闭环

已经实现：

- Web 页面创建深度调研任务
- API 创建任务和任务工作区
- SSE 推送任务事件
- 前端展示执行时间线
- 生成并预览 `output/report.md`
- 展示工作区文件列表
- 点击查看 `sources/`、`notes/`、`output/` 中的文件内容
- 任务元信息、状态和事件持久化到 `data/tasks.json`

### 3.3 Runner 模式

当前支持三种 runner：

```text
AGENT_RUNNER=mock
```

用于稳定演示产品闭环，不调用 OpenCode。

```text
AGENT_RUNNER=opencode
```

使用 CLI 路线：

```bash
opencode run --dir <workspace>
```

如果设置 `OPENCODE_SERVER_URL`，则使用：

```bash
opencode run --attach <server-url> --dir <workspace>
```

```text
AGENT_RUNNER=opencode-sdk
```

使用 SDK 路线：

```text
createOpencodeClient({ baseUrl, directory })
client.session.create()
client.session.prompt()
client.global.event()
```

这是当前主推路线。

## 4. OpenCode SDK 关键结论

### 4.1 SDK 启动 server 的方式

`createOpencodeServer()` 内部本质上是启动：

```bash
opencode serve --hostname=<host> --port=<port>
```

然后等待 stdout 出现 server listening 信息，返回：

```js
{
  url,
  close()
}
```

也就是说 SDK 没有神秘内嵌 runtime，而是在 Node 里托管一个 OpenCode CLI server 进程。

### 4.2 SDK client 和 server 的交互

核心流程：

```text
createOpencodeClient({ baseUrl, directory })
  -> 设置 x-opencode-directory header
  -> 绑定业务任务工作区

client.session.create({ body: { title } })
  -> 创建 OpenCode session

client.session.prompt({ path: { id }, body: { parts } })
  -> 向 session 发送业务任务

client.global.event()
  -> 订阅 OpenCode SSE 事件流
```

### 4.3 工作区绑定结论

已验证：

```js
createOpencodeClient({
  baseUrl: "http://127.0.0.1:4096",
  directory: workspace.path,
})
```

可以让 OpenCode 在指定业务工作区中执行，并写入：

```text
output/report.md
```

不建议手写：

```text
POST /session?directory=...
```

因为之前验证发现：session 返回的 directory 看似正确，但实际写文件可能落在项目根目录。

## 5. 事件流接入

当前已经将 OpenCode 原始事件映射为业务时间线事件。

已支持的映射：

```text
session.created       -> opencode-session
session.status        -> opencode-status
session.idle          -> opencode-idle
session.error         -> failed
message.updated       -> opencode-message
message.part.updated  -> tool / opencode-message / opencode-step
file.edited           -> artifact
permission.updated    -> permission
```

过滤规则：

- 只接收当前 `workspace.path` 对应的 OpenCode event
- 有 `sessionID` 的事件必须匹配当前任务的 `session.id`
- 映射后的事件保留 `rawType`，便于调试

## 6. Docker Compose 当前状态

最初 Docker Compose 构建失败，真实错误是：

```text
failed to solve: file with no instructions
```

原因是：

```text
infra/docker/Dockerfile.api
```

之前只是占位注释，没有 Docker 指令。

当前已补齐：

- `.dockerignore`
- `infra/docker/Dockerfile.api`
- `infra/compose/docker-compose.dev.yml` 中 API 的端口和 volume
- `infra/scripts/test-compose-api.sh`

现在可以通过 Compose 测 API 基线：

```bash
bash infra/scripts/test-compose-api.sh
```

该脚本会执行：

```text
docker compose config
docker compose build api
docker compose up -d api
curl http://127.0.0.1:3001/api/health
```

当前验证结果：

```text
OK: http://127.0.0.1:3001/api/health
```

注意：当前 Compose 只验证 API + mock runner。真实 `opencode-sdk` 容器化还未完成，因为它涉及 OpenCode CLI 安装、认证、模型 Key 和容器间网络。

### 6.1 真实 OpenCode Compose 链路

已新增：

- `infra/docker/Dockerfile.opencode`
- `infra/compose/docker-compose.opencode.yml`
- `infra/scripts/test-compose-opencode.sh`

该链路使用两个容器：

```text
api
  -> AGENT_RUNNER=opencode
  -> OPENCODE_SERVER_URL=http://opencode:4096
  -> opencode run --attach http://opencode:4096 --dir <workspace>

opencode
  -> opencode serve --hostname 0.0.0.0 --port 4096
```

宿主机访问端口：

```text
API:      http://127.0.0.1:3101
OpenCode: http://127.0.0.1:4096
```

当前验证结论：

- API 容器可以访问 `http://opencode:4096/config`。
- API 容器可以通过 SDK 成功 `client.session.create()`。
- 业务 workspace 路径在容器内为 `/workspace/workspaces/<run-id>`，API 与 OpenCode 共享该目录。
- 容器内直接调用 DashScope compatible API 成功返回 `OK`，说明网络和 `DASHSCOPE_API_KEY` 可用。
- 容器内直接执行 `opencode run --model alibaba-cn/qwen-plus` 成功返回 `OK`。
- API 容器通过 `opencode run --attach http://opencode:4096` 已成功驱动 OpenCode 容器生成 `output/report.md`。

已知问题：

- `client.session.prompt()` 在 serve + SDK 路线中会卡住或返回：

```text
OpenCode prompt timed out after 45000ms
MessageAbortedError: Aborted
```

因此当前 Compose 真实链路先使用已验证稳定的 CLI attach runner；SDK prompt 保留为后续专项排查。

注意：不要把 `docker compose config` 的完整输出贴到公开渠道，因为它会展开环境变量，可能包含模型 Key。

## 7. 常用启动方式

### 7.1 本地 mock 模式

```bash
npm run dev:api
```

打开：

```text
http://127.0.0.1:3001/
```

### 7.2 本地 OpenCode SDK 模式

先启动 OpenCode server：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

再启动 API：

```bash
OPENCODE_SERVER_URL=http://127.0.0.1:4096 AGENT_RUNNER=opencode-sdk npm run dev:api
```

打开：

```text
http://127.0.0.1:3001/
```

### 7.3 单独验证 SDK 链路

```bash
node scripts/verify-opencode-sdk.js
```

该脚本会启动临时 OpenCode server，创建 session，发送 prompt，并验证 `output/report.md` 是否写入绑定的 workspace。

### 7.4 Docker Compose API 验证

```bash
bash infra/scripts/test-compose-api.sh
```

### 7.5 Docker Compose OpenCode 验证

```bash
bash infra/scripts/test-compose-opencode.sh
```

该脚本会：

```text
docker compose config
docker compose build api opencode
docker compose up -d opencode api
curl http://127.0.0.1:3101/api/health
POST /api/tasks
轮询任务状态
失败时打印 task payload 和容器日志
```

## 8. 测试状态

当前测试命令：

```bash
npm test
```

已通过测试覆盖：

- workspace 创建
- workspace 文件列表
- task store 文件持久化
- mock runner
- OpenCode CLI runner
- OpenCode SDK runner
- OpenCode 事件映射
- API 文件列表和文件读取

当前验证结果：

```text
14 个测试全部通过
```

## 9. 下一步建议

建议下一步按这个顺序推进：

1. **权限请求闭环**
   - 当前 `permission.updated` 只会显示到 timeline
   - 后续需要 Web 显示“允许 / 拒绝”
   - API 调 OpenCode 权限接口回传用户选择

2. **强化深度调研 agent prompt**
   - 先制定调研计划
   - 保存来源
   - 生成中间分析
   - 输出结构化报告
   - 无法联网时明确说明限制

3. **SDK prompt 专项排查**
   - 当前 `client.session.create()` 可用
   - `client.session.prompt()` 在 serve 模式下会卡住或返回 `MessageAbortedError`
   - CLI `opencode run --attach` 已验证可用，可作为当前真实运行基线

4. **更可靠的任务恢复**
   - 当前已持久化任务和事件
   - 后续可增加启动时扫描 workspace、补齐缺失报告状态
   - 再评估是否升级到 SQLite/Postgres

## 10. 当前项目判断

这个 POC 已经证明：

- OpenCode 可以作为业务 agent runtime 使用
- SDK 路线可以完成 server/client/session/prompt/event 的闭环
- Web/API 层可以把 OpenCode 包装成业务任务产品
- 工作区模型适合承载来源、笔记、报告等业务产物
- Docker Compose 已经具备 API mock 基线和真实 OpenCode attach 基线
- 任务状态和事件已经具备 JSON 文件持久化

还没有完成的是生产级运行：权限审批、任务恢复增强、SDK prompt 问题专项、模型/认证配置管理。
