# ADR-0004：采用 assistant-ui copy-paste 组件路线

## 状态

已接受

## 背景

AgentDesk 的聊天界面需要接近 Codex / Claude 这类实时 Agent 交互体验，同时又要能深度定制项目、会话、工具调用、权限和事件展示。

前期实现直接使用 `@assistant-ui/react` primitives，在 `App.tsx` 中手工组合 `ThreadPrimitive`、`MessagePrimitive` 和 `ComposerPrimitive`。这种方式验证速度快，但组件结构会逐渐集中在单个文件里，不利于长期维护。

## 决策

采用 assistant-ui 的 copy-paste / registry 路线，将官方组件源码拉入项目：

- 组件目录：`apps/web/src/components/assistant-ui/`
- registry 配置：`components.json`
- 别名：`@/* -> apps/web/src/*`

当前仍保留现有业务聊天界面，先完成组件源码落地和编译通过。后续逐步将 `App.tsx` 中的消息、工具、reasoning 和 composer UI 拆到 copy-paste 组件中。

## 影响

- 可以像 shadcn/ui 一样直接修改组件源码。
- 后续 UI 定制不再受限于 npm 包内部实现。
- 项目需要维护 copy-paste 组件与 `@assistant-ui/react` primitives 的兼容关系。
- 引入了 registry 组件依赖：`radix-ui`、`tw-shimmer`、`class-variance-authority`、`zustand`、`@assistant-ui/react-markdown`。
