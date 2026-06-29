import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createTaskWorkspace, readWorkspaceFile } from "../../packages/agent-workspace/src/workspace.js";
import { OpenCodeSdkRunner } from "../../packages/opencode-runner/src/opencode-sdk-runner.js";

test("OpenCodeSdkRunner creates a session with an SDK client bound to the task workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sdk-runner-test-"));
  const calls = [];

  try {
    const workspace = await createTaskWorkspace(root, "SDK 工作区验证");
    const runner = new OpenCodeSdkRunner({
      baseUrl: "http://127.0.0.1:4096",
      createClient: (config) => {
        calls.push(["createClient", config]);
        return {
          event: {
            subscribe: async () => ({
              stream: (async function* () {})(),
            }),
          },
          session: {
            create: async (options) => {
              calls.push(["session.create", options]);
              return { data: { id: "ses_sdk_1" } };
            },
            prompt: async (options) => {
              calls.push(["session.prompt", options]);
              return { data: { info: { id: "msg_1" }, parts: [] } };
            },
          },
        };
      },
    });
    const events = [];

    await runner.runResearchTask({
      taskId: "task_sdk_1",
      prompt: "SDK 工作区验证",
      workspace,
      messageId: "msg_user_1",
      onEvent: (event) => events.push(event),
    });

    assert.equal(calls[0][0], "createClient");
    assert.equal(calls[0][1].baseUrl, "http://127.0.0.1:4096");
    assert.equal(calls[0][1].directory, workspace.path);

    assert.deepEqual(calls[1], [
      "session.create",
      {
        body: {
          title: "SDK 工作区验证",
        },
      },
    ]);

    assert.equal(calls[2][0], "session.prompt");
    assert.equal(calls[2][1].path.id, "ses_sdk_1");
    assert.equal("model" in calls[2][1].body, false);
    assert.equal(calls[2][1].body.parts[0].type, "text");
    assert.equal(calls[2][1].body.parts[0].text, "SDK 工作区验证");
    assert.doesNotMatch(calls[2][1].body.parts[0].text, /业务深度调研智能体/);

    assert.deepEqual(
      events.map((event) => event.type),
      ["opencode-raw", "opencode-raw"],
    );
    assert.deepEqual(
      events.map((event) => event.rawType),
      ["sdk.session.create", "sdk.session.prompt.result"],
    );
    assert.deepEqual(
      events.map((event) => event.messageId),
      ["msg_user_1", "msg_user_1"],
    );

    const report = await readWorkspaceFile(workspace, "output/report.md");
    assert.match(report, /SDK 工作区验证/);
    assert.match(report, /OpenCode SDK/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCodeSdkRunner forwards OpenCode SSE events into task timeline events", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sdk-events-test-"));

  try {
    const workspace = await createTaskWorkspace(root, "SDK 事件验证");
    const runner = new OpenCodeSdkRunner({
      baseUrl: "http://127.0.0.1:4096",
      createClient: () => ({
        event: {
            subscribe: async () => ({
              stream: (async function* () {
              yield {
                directory: workspace.path,
                payload: {
                  type: "message.part.updated",
                  properties: {
                    part: {
                      type: "tool",
                      sessionID: "ses_sdk_2",
                      tool: "write",
                      state: {
                        status: "running",
                        input: {
                          filePath: "output/report.md",
                        },
                      },
                    },
                  },
                },
              };
              yield {
                directory: workspace.path,
                payload: {
                  type: "file.edited",
                  properties: {
                    file: join(workspace.path, "output/report.md"),
                  },
                },
              };
            })(),
          }),
        },
        session: {
          create: async () => ({ data: { id: "ses_sdk_2" } }),
          prompt: async () => ({ data: { info: { id: "msg_2" }, parts: [] } }),
        },
      }),
    });
    const events = [];

    await runner.runResearchTask({
      taskId: "task_sdk_events",
      prompt: "SDK 事件验证",
      workspace,
      onEvent: (event) => events.push(event),
    });

    const visibleEvents = events.filter((event) => event.rawType !== "sdk.event.subscribe.observed");
    assert.deepEqual(
      visibleEvents.map((event) => event.type),
      ["opencode-raw", "opencode-raw", "opencode-raw", "opencode-raw"],
    );
    assert.equal(visibleEvents[1].rawType, "message.part.updated");
    assert.equal(visibleEvents[1].raw.payload.type, "message.part.updated");
    assert.equal(visibleEvents[1].raw.payload.properties.part.tool, "write");
    assert.equal(visibleEvents[2].rawType, "file.edited");
    assert.equal(visibleEvents[2].raw.payload.type, "file.edited");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});



test("OpenCodeSdkRunner records observed global SSE events before filtering", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sdk-observed-events-test-"));

  try {
    const workspace = await createTaskWorkspace(root, "SDK 诊断事件验证");
    const runner = new OpenCodeSdkRunner({
      createClient: () => ({
        event: {
            subscribe: async () => ({
              stream: (async function* () {
              yield {
                directory: "/other/workspace",
                payload: {
                  type: "message.part.updated",
                  properties: {
                    part: {
                      type: "tool",
                      sessionID: "other_session",
                      tool: "websearch",
                    },
                  },
                },
              };
              yield {
                directory: workspace.path,
                payload: {
                  type: "message.part.updated",
                  properties: {
                    part: {
                      type: "tool",
                      sessionID: "ses_observed",
                      tool: "write",
                    },
                  },
                },
              };
            })(),
          }),
        },
        session: {
          create: async () => ({ data: { id: "ses_observed" } }),
          prompt: async () => ({ data: { info: { id: "msg_observed" }, parts: [] } }),
        },
      }),
    });
    const events = [];

    await runner.runResearchTask({
      taskId: "task_sdk_observed",
      prompt: "SDK 诊断事件验证",
      workspace,
      messageId: "msg_user_observed",
      onEvent: (event) => events.push(event),
    });

    const observed = events.filter((event) => event.rawType === "sdk.event.subscribe.observed");
    assert.equal(observed.length, 2);
    assert.deepEqual(
      observed.map((event) => event.raw.diagnostics),
      [
        { workspaceMatched: false, sessionMatched: false, payloadType: "message.part.updated" },
        { workspaceMatched: true, sessionMatched: true, payloadType: "message.part.updated" },
      ],
    );
    assert.equal(events.some((event) => event.rawType === "message.part.updated"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCodeSdkRunner reuses the same OpenCode session for follow-up prompts in one task", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sdk-session-reuse-test-"));
  const calls = [];

  try {
    const workspace = await createTaskWorkspace(root, "SDK 多轮会话验证");
    const runner = new OpenCodeSdkRunner({
      createClient: () => ({
        event: {
            subscribe: async () => ({
              stream: (async function* () {})(),
          }),
        },
        session: {
          create: async (options) => {
            calls.push(["session.create", options]);
            return { data: { id: "ses_reused" } };
          },
          prompt: async (options) => {
            calls.push(["session.prompt", options]);
            return { data: { info: { id: `msg_${calls.length}` }, parts: [] } };
          },
        },
      }),
    });

    await runner.runResearchTask({
      taskId: "task_reuse",
      prompt: "第一句",
      workspace,
      onEvent: () => {},
    });
    await runner.runResearchTask({
      taskId: "task_reuse",
      prompt: "第二句",
      workspace,
      onEvent: () => {},
    });

    assert.equal(calls.filter(([name]) => name === "session.create").length, 1);
    assert.deepEqual(
      calls.filter(([name]) => name === "session.prompt").map(([, options]) => options.path.id),
      ["ses_reused", "ses_reused"],
    );
    assert.deepEqual(
      calls.filter(([name]) => name === "session.prompt").map(([, options]) => options.body.parts[0].text),
      ["第一句", "第二句"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCodeSdkRunner passes an explicit OpenCode Zen DeepSeek Flash model when configured", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sdk-model-test-"));
  const calls = [];

  try {
    const workspace = await createTaskWorkspace(root, "SDK 模型验证");
    const runner = new OpenCodeSdkRunner({
      model: {
        providerID: "opencode",
        modelID: "deepseek-v4-flash-free",
      },
      createClient: () => ({
        event: {
            subscribe: async () => ({
              stream: (async function* () {})(),
          }),
        },
        session: {
          create: async () => ({ data: { id: "ses_sdk_model" } }),
          prompt: async (options) => {
            calls.push(options);
            return { data: { info: { id: "msg_model" }, parts: [] } };
          },
        },
      }),
    });

    await runner.runResearchTask({
      taskId: "task_sdk_model",
      prompt: "SDK 模型验证",
      workspace,
      onEvent: () => {},
    });

    assert.deepEqual(calls[0].body.model, {
      providerID: "opencode",
      modelID: "deepseek-v4-flash-free",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCodeSdkRunner fails when OpenCode returns a prompt error", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sdk-error-test-"));

  try {
    const workspace = await createTaskWorkspace(root, "SDK 错误验证");
    const runner = new OpenCodeSdkRunner({
      createClient: () => ({
        event: {
            subscribe: async () => ({
              stream: (async function* () {})(),
          }),
        },
        session: {
          create: async () => ({ data: { id: "ses_sdk_error" } }),
          prompt: async () => ({
            data: {
              info: {
                error: {
                  name: "MessageAbortedError",
                  data: {
                    message: "Aborted",
                  },
                },
              },
              parts: [],
            },
          }),
        },
      }),
    });

    await assert.rejects(
      () =>
        runner.runResearchTask({
          taskId: "task_sdk_error",
          prompt: "SDK 错误验证",
          workspace,
          onEvent: () => {},
        }),
      /MessageAbortedError: Aborted/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCodeSdkRunner aborts the prompt when it exceeds the configured timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-sdk-timeout-test-"));

  try {
    const workspace = await createTaskWorkspace(root, "SDK 超时验证");
    const runner = new OpenCodeSdkRunner({
      promptTimeoutMs: 10,
      createClient: () => ({
        event: {
            subscribe: async () => ({
              stream: (async function* () {})(),
          }),
        },
        session: {
          create: async () => ({ data: { id: "ses_sdk_timeout" } }),
          prompt: async ({ signal }) =>
            new Promise((resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason));
              setTimeout(() => resolve({ data: { info: {}, parts: [] } }), 100);
            }),
        },
      }),
    });

    await assert.rejects(
      () =>
        runner.runResearchTask({
          taskId: "task_sdk_timeout",
          prompt: "SDK 超时验证",
          workspace,
          onEvent: () => {},
        }),
      /OpenCode prompt timed out after 10ms/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
