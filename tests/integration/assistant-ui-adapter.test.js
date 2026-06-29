import assert from "node:assert/strict";
import test from "node:test";

import { toAssistantUiMessages } from "../../apps/web/src/runtime/assistant-ui-adapter.ts";

test("assistant-ui adapter hides reasoning from completed transcript messages", () => {
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
      runSummary: { status: "running", actions: [] },
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


test("assistant-ui adapter converts operational parts into visible tool calls", () => {
  const messages = toAssistantUiMessages([
    {
      id: "assistant-run-msg_1",
      role: "assistant",
      runSummary: { status: "running", actions: [] },
      parts: [
        { type: "file", file: "output/report.md" },
        { type: "permission", title: "Allow network" },
        { type: "error", message: "boom" },
      ],
    },
  ]);

  assert.equal(messages[0].content[0].type, "tool-call");
  assert.equal(messages[0].content[0].toolName, "file.edited");
  assert.deepEqual(messages[0].content[0].args, { file: "output/report.md" });
  assert.equal(messages[0].content[1].toolName, "permission.request");
  assert.deepEqual(messages[0].content[1].args, { title: "Allow network" });
  assert.equal(messages[0].content[2].toolName, "opencode.error");
  assert.deepEqual(messages[0].content[2].result, { message: "boom" });
});

test("assistant-ui adapter assigns unique tool call ids for duplicate operational parts", () => {
  const messages = toAssistantUiMessages([
    {
      id: "assistant-run-msg_1",
      role: "assistant",
      runSummary: { status: "running", actions: [] },
      parts: [
        { type: "raw_json", label: "opencode.event", raw: { type: "step-start" } },
        { type: "raw_json", label: "opencode.event", raw: { type: "step-start" } },
      ],
    },
  ]);

  assert.equal(messages[0].content[0].type, "tool-call");
  assert.equal(messages[0].content[1].type, "tool-call");
  assert.notEqual(messages[0].content[0].toolCallId, messages[0].content[1].toolCallId);
});


test("assistant-ui adapter keeps assistant message running while run summary is active", () => {
  const messages = toAssistantUiMessages([
    {
      id: "assistant-run-msg_1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "thinking" }],
      runSummary: { status: "running", actions: [] },
    },
  ]);

  assert.deepEqual(messages[0].status, { type: "running" });
});



test("assistant-ui adapter uses OpenCode tool part id as stable toolCallId", () => {
  const messages = toAssistantUiMessages([
    {
      id: "assistant-run-msg_1",
      role: "assistant",
      runSummary: { status: "running", actions: [] },
      parts: [{ type: "tool", id: "prt_1", tool: "websearch", status: "completed", input: { query: "x" } }],
    },
  ]);

  assert.equal(messages[0].content[0].type, "tool-call");
  assert.equal(messages[0].content[0].toolCallId, "prt_1");
});

test("assistant-ui adapter hides completed intermediate text before tool calls", () => {
  const messages = toAssistantUiMessages([
    {
      id: "assistant-run-msg_1",
      role: "assistant",
      runSummary: { status: "completed", actions: [{ id: "a1", kind: "web_search", label: "搜索网页" }] },
      parts: [
        { type: "assistant_text", text: "I will search first." },
        { type: "tool", id: "tool_1", tool: "websearch", input: { query: "agent ui" } },
        { type: "assistant_text", text: "Final answer part 1" },
        { type: "assistant_text", text: "Final answer part 2" },
      ],
    },
  ]);

  assert.deepEqual(messages[0].content, [
    { type: "text", text: "Final answer part 1" },
    { type: "text", text: "Final answer part 2" },
  ]);
});