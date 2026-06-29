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

test("web transcript restores a historical task as a continuous conversation", () => {
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
  assert.deepEqual(
    session.messages[1].parts.map((part) => part.type),
    ["raw_json"],
  );
});
