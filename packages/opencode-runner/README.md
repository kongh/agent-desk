# OpenCode Runner

封装 OpenCode serve 和 OpenCode SDK。

职责：

- 启动或连接 OpenCode server。
- 创建和恢复 session。
- 向指定智能体发送 prompt。
- 订阅事件流。
- 处理权限响应。
- 获取 diff 和输出文件。

## Runner 模式

- `mock`：不调用 OpenCode，用固定事件和文件验证产品闭环。
- `opencode`：调用 `opencode run --dir <workspace>`；如果设置 `OPENCODE_SERVER_URL`，则调用 `opencode run --attach <url> --dir <workspace>`。
- `opencode-sdk`：使用 `@opencode-ai/sdk` 连接 `opencode serve`，通过 SDK client 的 `directory` 配置绑定业务工作区。

## SDK 链路

SDK 路线的最小交互过程：

```text
opencode serve
  -> createOpencodeClient({ baseUrl, directory: workspace.path })
  -> client.session.create({ body: { title } })
  -> client.session.prompt({ path: { id }, body: { parts: [{ type: "text", text }] } })
  -> OpenCode 在 workspace.path 下写入 output/report.md
```

本地验证脚本：

```bash
node scripts/verify-opencode-sdk.js
```
