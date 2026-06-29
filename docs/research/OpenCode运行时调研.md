# OpenCode 运行时调研

## 调研问题

- 后端应该如何启动和连接 `opencode serve`？
- 哪些 OpenCode 事件需要映射到业务任务时间线？
- 权限请求如何从 OpenCode 传递到 Web UI？
- 哪些业务能力适合做成 OpenCode custom tools？
- 哪些外部系统适合通过 MCP 接入？

## 初步判断

本项目将 OpenCode 视为业务智能体运行时，而不是只服务于代码仓库的工具。项目应优先复用 OpenCode 的 server、SDK、agent profile、command、permission、event stream 和 workspace-based execution。

## V2 用 OpenCode 的选型依据

OpenCode 更适合被 Web 产品包一层，因为它官方已经提供 headless server、Web 模式和 SDK，不需要我们从零实现 agent loop 和任务运行时。

- OpenCode Intro：OpenCode 是开源 AI coding agent，支持 terminal、desktop app、IDE extension。
- OpenCode CLI：提供 `opencode run` 非交互模式、`opencode serve` headless server、`opencode web` Web UI、`opencode attach` 连接远程 server。
- OpenCode Web：官方 Web 模式，`opencode web` 会启动本地 server 并打开浏览器，可作为交互形态参考。
- OpenCode Server：`opencode serve` 暴露 HTTP / OpenAPI 接口，支持 sessions、messages、diff、files、events、permissions 等能力。
- OpenCode SDK：`@opencode-ai/sdk` 可以启动 server 或连接已有 server，用 JS/TS 控制 session、prompt、文件读取、事件流等。

这些能力对应到本项目：

```text
Web UI
  -> API Backend
      -> OpenCode Runner
          -> opencode run / opencode serve
          -> sessions / messages / events / permissions
      -> Task Workspace
          -> input / sources / notes / output / logs
```

## 当前实现状态

- 已实现 `MockOpenCodeRunner`，用于稳定演示产品闭环。
- 已实现 `OpenCodeServeRunner` 第一版，当前采用 `opencode run --dir <workspace>` 接入真实 OpenCode。
- 已实现 `OpenCodeSdkRunner` 第一版，当前采用 `@opencode-ai/sdk` 连接 `opencode serve`。
- 后端通过 `AGENT_RUNNER=mock|opencode|opencode-sdk` 切换 runner。
- 已验证 `opencode run --format json '只回复 OK'` 可正常返回。
- 曾遇到 `nvidia/deepseek-ai/deepseek-v4-pro` 返回 429 Too Many Requests；后续验证中 OpenCode 切换到 `opencode/deepseek-v4-flash-free` 后可正常返回。
- 当前 SDK runner 已能完成 `server -> client -> session -> prompt -> workspace output` 的最小闭环。后续还需要继续接入 SSE 事件、permission request 和 session 控制。

## serve API 验证记录

验证日期：2026-06-27

已验证：

- `opencode serve --hostname 127.0.0.1 --port 4096` 可以启动 headless server。
- `GET /config` 返回 OpenCode 配置。
- `GET /` 返回 OpenCode 自带 Web UI。
- `GET /doc` 返回 OpenAPI 文档，但当前只列出 `/auth/{providerID}` 和 `/log`，没有完整列出 session/message/event/diff 等内部接口。
- `GET /session` 可以列出历史 sessions。
- `POST /session` 可以创建 session。
- `GET /event` 是 SSE 事件流，会推送 `server.connected`、`session.created`、`session.updated` 等事件。
- `POST /session/:sessionID/message` 可以向 session 发送消息，并触发模型调用。
- `GET /session/:sessionID/message` 可以读取消息列表和 message parts。
- `GET /session/:sessionID/diff` 可以读取 session diff。

发现的问题：

- 通过 `POST /session?directory=/private/tmp/opencode-serve-verify` 创建 session 时，返回对象中的 `directory` 看似正确，但后续 message 的 `path.cwd` 仍是项目根目录。
- 在上述情况下，模型写入 `output/report.md` 时实际写到了项目根目录，而不是传入的业务工作区。
- 因此，仅依赖 `POST /session?directory=...` 还不能证明 serve API 能正确绑定任务工作区。

当前结论：

- `opencode serve` 的 session、message、event、diff 能力可用。
- 直接 `POST /session?directory=...` 的工作区绑定不可靠。
- `opencode run --attach http://127.0.0.1:4096 --dir <workspace>` 已验证可以在 headless server 模式下正确绑定工作区，并将文件写入指定 workspace。
- 项目中的真实 runner 已支持 `OPENCODE_SERVER_URL=http://127.0.0.1:4096`，有该环境变量时会使用 attach 模式。

attach 模式验证命令：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
opencode run --attach http://127.0.0.1:4096 --dir /private/tmp/opencode-attach-verify --format json \
  '请直接写入 output/report.md，内容为：# attach 验证\n\nOK。不要反问。'
```

验证结果：

- JSON 事件中出现 `tool_use`，工具为 `write`。
- 写入路径为 `/private/tmp/opencode-attach-verify/output/report.md`。
- 文件内容验证通过。

## SDK 验证记录

验证日期：2026-06-27

SDK server 启动过程：

```text
createOpencodeServer({ hostname, port })
  -> SDK 内部 spawn: opencode serve --hostname=<hostname> --port=<port>
  -> 等待 stdout 出现 "opencode server listening on <url>"
  -> 返回 { url, close }
```

SDK client 和 server 交互过程：

```text
createOpencodeClient({ baseUrl, directory })
  -> SDK 设置 header: x-opencode-directory=<encoded directory>
  -> GET/HEAD 请求会被 SDK 自动补上 ?directory=<directory>
  -> POST 请求通过 header 将 directory 传给 server

client.session.create({ body: { title } })
  -> POST /session
  -> 返回 session.id

client.session.prompt({ path: { id }, body: { parts } })
  -> POST /session/:id/message
  -> OpenCode 在 SDK client 绑定的 directory 中执行任务
```

已新增验证脚本：

```bash
node scripts/verify-opencode-sdk.js
```

验证结果：

- SDK 启动 server：`http://127.0.0.1:4097`。
- SDK client 绑定工作区：`/var/folders/_g/9ptr9jdj19300s8t3_02g2pr0000gn/T/opencode-sdk-verify`。
- `client.session.create` 成功返回 session id。
- `client.session.prompt` 成功触发 OpenCode 写入文件。
- 文件写入位置为绑定工作区下的 `output/report.md`。
- 文件内容为：

```markdown
# SDK attach 验证

OK
```

SDK 路线当前结论：

- `@opencode-ai/sdk` 可以直接启动 `opencode serve`，也可以连接已有 server。
- 正确的工作区绑定方式是 `createOpencodeClient({ directory: workspace.path })`。
- 不建议手写 `POST /session?directory=...` 作为工作区绑定依据，因为前面的手工验证出现过返回 session directory 正确但实际 cwd 不正确的问题。
- 对本项目来说，SDK runner 应该作为长期路线；CLI attach runner 可以保留为故障排查和降级手段。

## 后续验证

- 验证 SDK SSE event 如何映射到业务任务时间线。
- 验证 permission request 如何通过后端转发到 Web UI，并将用户选择回传给 OpenCode。
- 验证深度调研智能体能否按照约定保存证据和报告。
