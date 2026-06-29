# MVP 实现计划

## 目标

实现一个可本地运行的 AgentDesk 智能体工作台最小闭环：用户在 Web 输入调研任务，后端创建任务工作区，runner 产生任务事件，Web 实时展示执行过程，最终展示报告。

## 边界

- 本轮不接真实 OpenCode SDK，先实现 `AgentRunner` 抽象和 `MockOpenCodeRunner`。
- 后续接入真实 OpenCode 时，只替换 runner，不重写 Web/API/工作区模型。
- 先使用 Node.js 原生 HTTP 服务和静态前端，避免项目初始化阶段引入过多框架依赖。

## 模块

- `packages/agent-workspace`：创建任务工作区和标准目录。
- `packages/opencode-runner`：定义 runner 接口和 mock runner。
- `apps/api`：任务服务、HTTP API、SSE 事件流、静态文件托管。
- `apps/web`：业务任务输入、时间线、报告预览。

## 验收标准

- `npm test` 可以通过核心模块测试。
- `npm run dev:api` 可以启动本地服务。
- 打开 `http://localhost:3001` 可以创建深度调研任务。
- 页面能看到任务事件流和最终报告。
- 工作区中生成 `sources/`、`notes/`、`output/report.md`。
