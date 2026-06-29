import assert from "node:assert/strict";
import test from "node:test";

import { toAssistantUiMessages } from "../../apps/web/src/runtime/assistant-ui-adapter.ts";

test("assistant-ui adapter converts transcript text and reasoning parts", () => {
  const messages = toAssistantUiMessages([
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "assistant_text", text: "**answer**" },
        { type: "reasoning", text: "thinking" },
      ],
    },
  ]);

  assert.equal(messages[0].role, "user");
  assert.deepEqual(messages[0].content, [{ type: "text", text: "hello" }]);
  assert.equal(messages[1].role, "assistant");
  assert.deepEqual(messages[1].content, [
    { type: "text", text: "**answer**" },
    { type: "reasoning", text: "thinking" },
  ]);
  assert.deepEqual(messages[1].status, { type: "complete", reason: "stop" });
});

test("assistant-ui adapter marks empty assistant messages as running", () => {
  const messages = toAssistantUiMessages([
    {
      id: "assistant-run-msg_1",
      role: "assistant",
      parts: [],
    },
  ]);

  assert.deepEqual(messages[0].status, { type: "running" });
  assert.deepEqual(messages[0].content, []);
});

test("assistant-ui adapter converts tool parts into assistant-ui tool calls", () => {
  const messages = toAssistantUiMessages([
    {
      id: "assistant-run-msg_1",
      role: "assistant",
      parts: [
        {
          type: "tool",
          tool: "write",
          input: { path: "output/report.md" },
          output: { ok: true },
        },
      ],
    },
  ]);

  assert.equal(messages[0].content[0].type, "tool-call");
  assert.equal(messages[0].content[0].toolName, "write");
  assert.deepEqual(messages[0].content[0].args, { path: "output/report.md" });
  assert.deepEqual(messages[0].content[0].result, { ok: true });
});
