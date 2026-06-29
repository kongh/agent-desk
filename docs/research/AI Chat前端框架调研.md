# AI Chat 前端框架调研

## 背景

本项目正在从静态 MVP 走向实时交互型 Web Agent。新的前端不只是展示任务表单和报告，而是要支持类似 Codex / OpenCode 的持续交互：

- 用户可以围绕同一个项目持续对话。
- Agent 执行过程需要实时展示。
- 工具调用、权限确认、文件产物、错误和恢复都应成为消息流的一部分。
- 后端运行时以 OpenCode 为核心，当前稳定路线是 `opencode serve + opencode run --attach`。

因此，前端需要从原生 HTML / JS 迁移到更适合复杂交互状态的框架。

## 结论

第一阶段采用：

```text
React + Vite + TypeScript
自研 Agent Chat Runtime
Tailwind CSS 作为布局和样式基础
SSE 起步，后续按需要升级 WebSocket
暂不引入完整 AI 组件框架
```

这里的“自研”不是从零手写所有视觉组件，而是自己掌握核心交互模型：

- 会话和项目模型
- 消息和消息分片模型
- Agent 执行事件模型
- 工具调用和工具结果模型
- 文件产物和权限确认模型
- 中断、恢复、失败重试模型

AI 组件框架可以作为参考或局部引入，但不应在第一阶段成为架构地基。

样式层采用 Tailwind CSS，而不是继续手写大块 CSS，也不是直接引入完整 UI 组件库。Tailwind 负责布局、间距、颜色、状态和响应式；业务组件由项目自己定义。复杂无障碍基础组件，如 Dialog、Popover、Tooltip、Menu，后续按需引入 Radix UI。

## 为什么不继续原生 JS

当前 `apps/web/public/app.js` 已经承担了：

- 任务创建
- SSE 订阅
- 会话列表
- 消息渲染
- 执行步骤渲染
- 报告和文件加载

这对 MVP 足够，但继续扩展会出现问题：

- 状态散落在全局变量中。
- DOM 更新和业务状态混在一起。
- 难以表达复杂消息结构。
- 难以复用组件。
- 后续权限确认、工具卡片、中断恢复会让单文件快速失控。

React + TypeScript 可以把这些能力拆成可维护的组件和类型。

## 候选方案

### 方案一：自研核心 Chat Runtime

做法：

- 使用 React 组件实现聊天界面。
- 使用 TypeScript 定义 `AgentMessage`、`MessagePart`、`AgentEvent`、`ToolCall`、`Artifact` 等类型。
- 使用 `useReducer + Context` 管理实时状态。
- 使用现有后端 SSE 事件作为输入，逐步演进协议。

优点：

- 完全贴合 OpenCode runtime。
- 能承载项目、工作区、文件、权限和审计等企业需求。
- 不被第三方 chat 协议绑死。
- 便于未来接入 SDK、CLI attach 或其他 agent runtime。

缺点：

- 需要自己实现消息状态和组件。
- 前期速度比套用组件库慢一点。

适合本项目第一阶段。

### 方案二：Vercel AI SDK UI

官方定位：

- `useChat` 用于创建实时聊天 UI。
- 它管理 input、messages、status、error 等状态。
- 它支持消息流式更新。
- 官方建议渲染 `message.parts`，因为 parts 可以承载 text、tool invocation、tool result 等复杂消息类型。

参考资料：

- [AI SDK UI Chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)

优点：

- 流式消息和状态管理成熟。
- `message.parts` 的思想和我们的 agent event/message part 设计很接近。
- 对工具调用、错误、停止生成等常见 chatbot 场景支持较好。

风险：

- 它更适合“前端调用 AI chat endpoint”的模式。
- 我们当前后端是 OpenCode runner + task event SSE，并不是标准 AI SDK UI message stream。
- 为了套用它，可能需要先适配协议，反而增加复杂度。

阶段性判断：

- 不作为第一阶段地基。
- 可以借鉴 `message.parts` 设计。
- 如果后端协议后续自然接近 AI SDK UI stream，再考虑接入。

### 方案三：assistant-ui

官方定位：

- 面向 React 的生产级 AI chat 体验。
- 提供组件、runtime 和 primitives。
- 支持 ChatGPT-style UI、copilots 和 agents。
- 文档强调它可以集成 Vercel AI SDK、直接 LLM 连接或自定义后端。

参考资料：

- [assistant-ui Docs](https://www.assistant-ui.com/docs)

优点：

- 更偏 UI 和 runtime primitives。
- 能快速得到较完整的聊天体验。
- 对 React 生态友好。

风险：

- 会引入自己的 runtime 抽象。
- 我们仍然需要把 OpenCode event、workspace、permission、artifact 映射进去。
- 如果早期引入，可能会让产品交互被组件库形态牵着走。

阶段性判断：

- 暂不作为第一阶段地基。
- 可作为 UI pattern 和组件结构参考。
- 当我们自研 runtime 模型稳定后，可评估是否局部引入 primitives。

### 方案四：CopilotKit

官方定位：

- 面向 agentic user experience 的前端栈。
- 支持 production chat、generative UI、shared state、human-in-the-loop workflows。
- 提供 `CopilotChat`、`CopilotSidebar`、`CopilotPopup` 等完整组件。
- 支持 AG-UI compatible backend。

参考资料：

- [CopilotKit Docs](https://docs.copilotkit.ai/)

优点：

- 覆盖 agent UI、共享状态、人机协作、工具渲染等更完整的 agentic 场景。
- 对“业务系统内嵌 AI copilot”很友好。

风险：

- 体系较重。
- 会引入 AG-UI / CopilotKit runtime 相关概念。
- 本项目当前的关键问题是 OpenCode runtime 接入和企业 agent 工作台形态，不是先接一个完整 copilot 平台。

阶段性判断：

- 不适合作为当前 MVP 重构地基。
- 可作为中后期参考，尤其是 human-in-the-loop、generative UI、shared state。

## 推荐架构

```text
apps/web
  React + Vite + TypeScript
  Tailwind CSS
  src/
    main.tsx
    App.tsx
    api/
      tasks.ts
      events.ts
    runtime/
      types.ts
      reducer.ts
      useAgentSession.ts
    components/
      layout/
      project/
      chat/
      inspector/
    styles/
      globals.css
```

核心类型先由项目自己定义：

```ts
type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  parts: MessagePart[];
};

type MessagePart =
  | { type: "text"; text: string }
  | { type: "run_step"; event: AgentEvent }
  | { type: "tool_call"; name: string; input?: unknown; status: "pending" | "running" | "completed" | "failed" }
  | { type: "artifact"; path: string; kind: string }
  | { type: "error"; message: string };
```

这和 AI SDK UI 的 `parts` 思路一致，但不绑定它的协议。

## 分阶段计划

### Phase 1：框架迁移

- 将 `apps/web` 迁移为 Vite React TypeScript。
- 接入 Tailwind CSS。
- 保留现有 API：`/api/tasks`、`/api/tasks/:id/events`、`/report`、`/files`。
- 用 React 重建当前页面结构。
- 不改变后端 runner。

### Phase 2：自研 Agent Chat Runtime

- 定义 `AgentMessage` 和 `MessagePart`。
- 将 task event 映射为 assistant message parts。
- 支持历史任务恢复为消息流。
- 支持运行中状态、失败状态和完成产物。

### Phase 3：实时交互增强

- 增加中断 / 继续 / 重试。
- 增加权限确认消息。
- 增加工具调用卡片。
- 增加文件产物预览。
- 评估 SSE 是否足够；如需要双向实时控制，再升级 WebSocket。

### Phase 4：评估 AI 组件框架

当我们自己的 runtime 模型稳定后，再评估：

- 是否接入 AI SDK UI 的 stream/message parts。
- 是否局部引入 assistant-ui primitives。
- 是否需要 CopilotKit / AG-UI 兼容层。

## 决策

当前决策：

```text
不从 0 写所有 UI 细节。
但从 0 掌控核心 Agent Chat Runtime。
第一阶段不引入 AI 组件框架作为地基。
第一阶段不引入 Ant Design、MUI、shadcn/ui 这类完整 UI 组件库。
第一阶段使用 Tailwind CSS 构建自有业务组件。
```

原因：

- 本项目的核心差异不在“聊天框”，而在 OpenCode runtime、项目工作区、工具调用、文件产物和企业权限模型。
- 过早引入 AI 组件框架会让我们先适配框架，而不是先定义自己的产品交互。
- React + TypeScript 足以支撑我们先把正确的交互模型做出来。
- Tailwind CSS 能提高布局和状态样式迭代速度，同时不把产品形态锁死在某套后台 UI 框架里。
