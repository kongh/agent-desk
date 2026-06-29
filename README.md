# AgentDesk 智能体工作台

AgentDesk 是一个面向企业场景的 Web 版智能体工作台。项目使用 OpenCode 作为智能体执行运行时，让智能体在任务工作区中调用工具、沉淀证据、生成报告和演示材料。

第一阶段聚焦深度调研智能体：用户输入调研主题后，智能体在工作区中收集资料、保存来源、撰写中间笔记，并输出可追溯的报告。

## 目录结构

- `docs/` - 产品目标、PRD、技术调研、架构设计、ADR 和智能体规格。
- `apps/web/` - Web 前端，用于任务输入、实时进度、权限审批和结果预览。
- `apps/api/` - 后端 API，负责任务、工作区、OpenCode session 和事件转发。
- `packages/opencode-runner/` - OpenCode server 和 SDK 封装。
- `packages/agent-workspace/` - 任务工作区创建、布局、清理和归档。
- `packages/business-tools/` - 暴露给 OpenCode 智能体的业务工具。
- `agents/opencode/` - OpenCode agent profile、command、tool 和配置资产。
- `infra/` - Docker、compose、nginx 和环境编排。
- `config/` - 环境变量示例、模型配置和权限预设。
- `workspaces/` - 本地开发任务工作区。

## MVP 目标

1. 为本地业务工作区启动 OpenCode server。
2. 从 Web UI 创建深度调研任务。
3. 将 OpenCode 事件流转成任务时间线。
4. 在工作区保存来源、笔记和最终报告。
5. 预览生成结果，并支持继续追问。

## 启动方式

默认使用 mock runner：

```bash
npm run dev:api
```

任务和事件默认持久化到：

```text
data/tasks.json
```

可通过 `TASK_STORE_FILE` 覆盖。

使用真实 OpenCode runner：

```bash
AGENT_RUNNER=opencode npm run dev:api
```

真实 runner 会调用 `opencode run --dir <workspace>`，要求本机已安装并登录 OpenCode。

如果已经启动了 `opencode serve`，可以让 runner attach 到该 server：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
OPENCODE_SERVER_URL=http://127.0.0.1:4096 AGENT_RUNNER=opencode npm run dev:api
```

使用 OpenCode SDK runner：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
OPENCODE_SERVER_URL=http://127.0.0.1:4096 AGENT_RUNNER=opencode-sdk npm run dev:api
```

SDK runner 会通过 `@opencode-ai/sdk` 创建 client，并用 `directory` 将 OpenCode session 绑定到当前业务任务工作区。

验证 SDK server/client 链路：

```bash
node scripts/verify-opencode-sdk.js
```

该脚本会用 SDK 启动一个临时 OpenCode server，创建 session，发送 prompt，并验证报告是否写入 SDK client 绑定的工作区。

Docker Compose 验证：

```bash
bash infra/scripts/test-compose-api.sh
bash infra/scripts/test-compose-opencode.sh
```

`test-compose-api.sh` 验证 API + mock runner。`test-compose-opencode.sh` 验证 API 容器通过 OpenCode SDK 连接 OpenCode server 容器生成报告。
