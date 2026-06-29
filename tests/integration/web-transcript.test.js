import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTaskEvent,
  appendUserMessage,
  createEmptySession,
  createPendingSession,
  hydrateTaskSession,
} from "../../apps/web/src/runtime/transcript.ts";

test("web transcript starts a new chat with no default assistant greeting", () => {
  const session = createEmptySession();

  assert.deepEqual(session.messages, []);
});

test("web transcript merges text deltas into a readable assistant text part", () => {
  const first = {
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.updated",
    raw: {
      type: "message.part.updated",
      properties: {
        delta: "hello",
      },
    },
    timestamp: "2026-06-28T10:00:00.000Z",
  };
  const second = {
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.updated",
    raw: {
      type: "message.part.updated",
      properties: {
        delta: " world",
      },
    },
    timestamp: "2026-06-28T10:00:01.000Z",
  };
  const completed = {
    type: "opencode-raw",
    status: "completed",
    rawType: "sdk.session.prompt.result",
    raw: {
      data: {
        info: {
          id: "msg_1",
        },
      },
    },
    timestamp: "2026-06-28T10:00:03.000Z",
  };

  let session = createPendingSession("生成一份调研报告");
  session = appendTaskEvent(session, first);
  session = appendTaskEvent(session, second);
  session = appendTaskEvent(session, completed);

  assert.equal(session.status, "completed");
  assert.equal(session.messages.length, 2);

  const assistantRun = session.messages.find((message) => message.id.startsWith("assistant-run-"));
  assert.ok(assistantRun);
  assert.deepEqual(
    assistantRun.parts.map((part) => part.type),
    ["assistant_text"],
  );
  assert.equal(assistantRun.parts[0].text, "hello world");
});

test("web transcript expands prompt result into answer and reasoning only", () => {
  let session = createPendingSession("hello");
  session = appendTaskEvent(session, {
    type: "opencode-raw",
    status: "completed",
    rawType: "sdk.session.prompt.result",
    raw: {
      data: {
        info: {
          providerID: "opencode",
          modelID: "deepseek-v4-flash",
          finish: "stop",
          tokens: {
            total: 10,
          },
        },
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "answer" },
          { type: "step-finish", reason: "stop" },
        ],
      },
    },
    timestamp: "2026-06-28T10:00:03.000Z",
  });

  const assistantRun = session.messages.find((message) => message.id.startsWith("assistant-run-"));
  assert.ok(assistantRun);
  assert.deepEqual(
    assistantRun.parts.map((part) => part.type),
    ["assistant_text", "reasoning"],
  );
  assert.equal(assistantRun.parts[0].text, "answer");
  assert.equal(assistantRun.parts[1].text, "thinking");
});

test("web transcript hides SDK session create lifecycle events from the chat", () => {
  let session = createPendingSession("hello");
  session = appendTaskEvent(session, {
    type: "opencode-raw",
    status: "running",
    rawType: "sdk.session.create",
    raw: {
      data: {
        sessionId: "ses_1",
      },
    },
    timestamp: "2026-06-28T10:00:03.000Z",
  });

  const assistantRun = session.messages.find((message) => message.id.startsWith("assistant-run-"));
  assert.ok(assistantRun);
  assert.deepEqual(assistantRun.parts, []);
});

test("web transcript keeps follow-up assistant responses in a new message", () => {
  let session = createPendingSession("first");
  session = appendTaskEvent(session, {
    type: "opencode-raw",
    status: "completed",
    rawType: "message.part.updated",
    raw: {
      type: "message.part.updated",
      properties: {
        delta: "first answer",
      },
    },
    timestamp: "2026-06-28T10:00:03.000Z",
  });

  session = appendUserMessage(session, "second");
  session = appendTaskEvent(session, {
    type: "opencode-raw",
    status: "completed",
    rawType: "message.part.updated",
    raw: {
      type: "message.part.updated",
      properties: {
        delta: "second answer",
      },
    },
    timestamp: "2026-06-28T10:01:03.000Z",
  });

  const assistantRuns = session.messages.filter((message) => message.id.startsWith("assistant-run-"));
  assert.equal(assistantRuns.length, 2);
  assert.equal(assistantRuns[0].parts[0].text, "first answer");
  assert.equal(assistantRuns[1].parts[0].text, "second answer");
});

test("web transcript assigns events to the assistant message matching messageId", () => {
  let session = hydrateTaskSession({
    id: "task_1",
    prompt: "first",
    agent: "general",
    status: "running",
    messages: [
      {
        id: "msg_1",
        role: "user",
        text: "first",
        timestamp: "2026-06-28T10:00:00.000Z",
      },
    ],
  });
  session = appendUserMessage(session, "second", "msg_2");
  session = appendTaskEvent(session, {
    type: "opencode-raw",
    status: "completed",
    rawType: "message.part.updated",
    messageId: "msg_1",
    raw: {
      type: "message.part.updated",
      properties: {
        delta: "first answer",
      },
    },
    timestamp: "2026-06-28T10:00:03.000Z",
  });
  session = appendTaskEvent(session, {
    type: "opencode-raw",
    status: "completed",
    rawType: "message.part.updated",
    messageId: "msg_2",
    raw: {
      type: "message.part.updated",
      properties: {
        delta: "second answer",
      },
    },
    timestamp: "2026-06-28T10:01:03.000Z",
  });

  const assistantRuns = session.messages.filter((message) => message.id.startsWith("assistant-run-"));
  assert.equal(assistantRuns.length, 2);
  assert.equal(assistantRuns[0].id, "assistant-run-msg_1");
  assert.equal(assistantRuns[0].parts[0].text, "first answer");
  assert.equal(assistantRuns[1].id, "assistant-run-msg_2");
  assert.equal(assistantRuns[1].parts[0].text, "second answer");
});

test("web transcript restores a historical task without rendering raw protocol events in chat", () => {
  const session = hydrateTaskSession(
    {
      id: "task_1",
      prompt: "验证任务",
      agent: "general",
      status: "completed",
      events: [
        {
          type: "opencode-raw",
          status: "running",
          rawType: "message.part.updated",
          raw: {
            type: "message.part.updated",
          },
          timestamp: "2026-06-28T10:00:01.000Z",
        },
      ],
    },
    "# 结果",
    [{ path: "output/report.md", kind: "markdown", size: 8 }],
  );

  assert.equal(session.messages[0].role, "user");
  assert.equal(session.messages[0].parts[0].type, "text");
  assert.equal(session.messages[1].role, "assistant");
  assert.deepEqual(session.messages[1].parts, []);
});

test("transcript keeps SDK global observed diagnostics out of chat messages", () => {
  let session = createPendingSession("hello");

  session = appendTaskEvent(session, {
    id: "evt_observed",
    taskId: "task_1",
    messageId: "msg_1",
    timestamp: "2026-06-29T08:00:00.000Z",
    type: "opencode-raw",
    status: "running",
    rawType: "sdk.event.subscribe.observed",
    raw: {
      diagnostics: {
        workspaceMatched: false,
        sessionMatched: false,
        payloadType: "message.part.updated",
      },
    },
  });

  assert.deepEqual(session.messages.at(-1).parts, []);
  assert.equal(session.title, "sdk.event.subscribe.observed");
});

test("transcript keeps OpenCode lifecycle events out of chat messages", () => {
  let session = createPendingSession("hello");

  for (const rawType of ["server.connected", "session.updated", "message.updated", "plugin.added", "catalog.updated", "session.diff"]) {
    session = appendTaskEvent(session, {
      id: `evt_${rawType}`,
      taskId: "task_1",
      messageId: "msg_1",
      timestamp: "2026-06-29T08:00:00.000Z",
      type: "opencode-raw",
      status: "running",
      rawType,
      raw: { type: rawType },
    });
  }

  assert.deepEqual(session.messages.at(-1).parts, []);
});

test("transcript renders message part delta as streaming assistant text", () => {
  let session = createPendingSession("hello");

  session = appendTaskEvent(session, {
    id: "evt_delta_1",
    taskId: "task_1",
    messageId: "msg_1",
    timestamp: "2026-06-29T08:00:00.000Z",
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.delta",
    raw: {
      type: "message.part.delta",
      properties: { field: "text", delta: "hello" },
    },
  });

  session = appendTaskEvent(session, {
    id: "evt_delta_2",
    taskId: "task_1",
    messageId: "msg_1",
    timestamp: "2026-06-29T08:00:01.000Z",
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.delta",
    raw: {
      type: "message.part.delta",
      properties: { field: "text", delta: " world" },
    },
  });

  assert.deepEqual(session.messages.at(-1).parts, [{ type: "assistant_text", text: "hello world" }]);
});

test("transcript does not duplicate prompt result text after streaming deltas", () => {
  let session = createPendingSession("hello");

  session = appendTaskEvent(session, {
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.delta",
    raw: {
      type: "message.part.delta",
      properties: { field: "text", delta: "final" },
    },
    timestamp: "2026-06-28T10:00:00.000Z",
  });

  session = appendTaskEvent(session, {
    type: "opencode-raw",
    status: "completed",
    rawType: "sdk.session.prompt.result",
    raw: {
      data: {
        parts: [
          { type: "text", text: "final" },
          { type: "reasoning", text: "thinking" },
        ],
      },
    },
    timestamp: "2026-06-28T10:00:03.000Z",
  });

  assert.deepEqual(session.messages.at(-1).parts, [
    { type: "assistant_text", text: "final" },
    { type: "reasoning", text: "thinking" },
  ]);
});

test("transcript keeps tool events as assistant-ui parts and readable run summary actions", () => {
  let session = createPendingSession("hello");

  session = appendTaskEvent(session, {
    id: "evt_tool",
    taskId: "task_1",
    messageId: "msg_1",
    timestamp: "2026-06-29T08:00:10.000Z",
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.updated",
    raw: {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "websearch",
          state: {
            status: "running",
            input: { query: "assistant-ui" },
          },
        },
      },
    },
  });

  session = appendTaskEvent(session, {
    id: "evt_file",
    taskId: "task_1",
    messageId: "msg_1",
    timestamp: "2026-06-29T08:00:20.000Z",
    type: "opencode-raw",
    status: "running",
    rawType: "file.edited",
    raw: {
      type: "file.edited",
      properties: { file: "output/report.md" },
    },
  });

  const assistantRun = session.messages.at(-1);
  assert.deepEqual(assistantRun.parts.map((part) => part.type), ["tool", "file"]);
  assert.equal(assistantRun.parts[0].tool, "websearch");
  assert.deepEqual(assistantRun.parts[0].input, { query: "assistant-ui" });
  assert.equal(assistantRun.parts[1].file, "output/report.md");
  assert.deepEqual(assistantRun.runSummary.actions.map((action) => [action.kind, action.label, action.target]), [
    ["web_search", "搜索网页", "assistant-ui"],
    ["write_file", "写入文件", "output/report.md"],
  ]);
});


test("transcript updates the same OpenCode tool part instead of appending duplicates", () => {
  let session = createPendingSession("search");

  const baseEvent = {
    taskId: "task_1",
    messageId: "msg_1",
    type: "opencode-raw",
    rawType: "message.part.updated",
  };

  session = appendTaskEvent(session, {
    ...baseEvent,
    id: "evt_tool_running",
    timestamp: "2026-06-29T08:00:10.000Z",
    status: "running",
    raw: {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_search_1",
          type: "tool",
          tool: "websearch",
          state: { status: "running", input: { query: "assistant-ui" } },
        },
      },
    },
  });

  session = appendTaskEvent(session, {
    ...baseEvent,
    id: "evt_tool_complete",
    timestamp: "2026-06-29T08:00:12.000Z",
    status: "running",
    raw: {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_search_1",
          type: "tool",
          tool: "websearch",
          state: {
            status: "completed",
            input: { query: "assistant-ui" },
            output: { results: ["ok"] },
          },
        },
      },
    },
  });

  const assistantRun = session.messages.at(-1);
  assert.equal(assistantRun.parts.length, 1);
  assert.equal(assistantRun.parts[0].type, "tool");
  assert.equal(assistantRun.parts[0].id, "prt_search_1");
  assert.equal(assistantRun.parts[0].status, "completed");
  assert.deepEqual(assistantRun.parts[0].output, { results: ["ok"] });
});

test("hydrates historical run summaries from event timestamps", () => {
  const session = hydrateTaskSession({
    id: "task_1",
    prompt: "验证任务",
    agent: "general",
    status: "completed",
    messages: [
      { id: "msg_1", role: "user", text: "验证任务", timestamp: "2026-06-28T10:00:00.000Z" },
    ],
    events: [
      {
        type: "opencode-raw",
        status: "running",
        rawType: "message.part.delta",
        messageId: "msg_1",
        raw: { type: "message.part.delta", properties: { field: "text", delta: "hello" } },
        timestamp: "2026-06-28T10:00:01.000Z",
      },
      {
        type: "opencode-raw",
        status: "completed",
        rawType: "sdk.session.prompt.result",
        messageId: "msg_1",
        raw: { data: { parts: [{ type: "text", text: "hello" }] } },
        timestamp: "2026-06-28T10:00:03.000Z",
      },
    ],
  });

  const assistantRun = session.messages.find((message) => message.id === "assistant-run-msg_1");
  assert.ok(assistantRun);
  assert.equal(assistantRun.runSummary.startedAt, "2026-06-28T10:00:01.000Z");
  assert.equal(assistantRun.runSummary.completedAt, "2026-06-28T10:00:03.000Z");
});