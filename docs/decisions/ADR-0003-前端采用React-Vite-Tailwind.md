# ADR-0003：前端采用 React、Vite、TypeScript 和 Tailwind CSS

## 状态

已接受

## 背景

项目正在从静态 MVP 走向实时交互型 Web Agent。前端需要支持：

- 项目级会话。
- 实时消息流。
- Agent 执行步骤。
- 工具调用和工具结果。
- 文件产物。
- 权限确认。
- 中断、恢复、重试等运行控制。

当前原生 HTML / CSS / JavaScript 实现已经可以验证 MVP，但不适合继续承载复杂状态和组件化交互。

## 决策

前端采用：

```text
React
Vite
TypeScript
Tailwind CSS
```

第一阶段自研 Agent Chat Runtime，不引入完整 AI 组件框架作为地基。

第一阶段不引入 Ant Design、MUI、shadcn/ui 作为主 UI 框架。需要 Dialog、Popover、Tooltip、Menu 等复杂无障碍基础组件时，后续按需引入 Radix UI。

## 依据

React + TypeScript 适合表达复杂的消息、事件、工具调用和产物状态。

Vite 足够轻，适合本地和内网 agent 工作台，不需要 Next.js 的 SSR、路由约定和服务端组件复杂度。

Tailwind CSS 可以提高布局、间距、状态色、响应式和暗色模式的迭代速度，同时避免被完整后台 UI 框架锁定视觉和交互形态。

完整 AI 组件框架，如 Vercel AI SDK UI、assistant-ui、CopilotKit，暂时只作为参考或后续局部引入对象。当前项目的核心差异在 OpenCode runtime、项目工作区、权限、工具和文件产物，而不只是聊天框。

## 影响

- `apps/web` 需要迁移为 Vite React TypeScript 应用。
- 前端组件需要围绕项目、会话、消息、运行事件、工具调用、产物和 inspector 重新拆分。
- 样式以 Tailwind utility class 为主，少量全局 CSS 用于基础变量和浏览器默认样式。
- 后续如果引入 Radix UI，应只用于复杂交互 primitives，而不是替代业务组件体系。

