# ADR-0001：使用 OpenCode 作为智能体运行时

## 状态

已接受

## 背景

产品目标是构建 AgentDesk 智能体工作台，而不是只做代码智能体。但 OpenCode 提供了可复用的运行时能力：agent profile、command、tool、permission、session、event stream 和基于工作区的执行模型。

## 决策

POC 阶段使用 OpenCode serve + SDK 作为主要执行运行时。

## 影响

- 平台可以把精力放在 Web 体验、工作区、业务工具、权限审批和交付物上。
- 业务能力通过 OpenCode agents、commands、custom tools 和 MCP 扩展。
- 需要一个清晰的 runner 层，避免 OpenCode 细节散落在整个应用里。
