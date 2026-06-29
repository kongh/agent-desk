import assert from "node:assert/strict";
import test from "node:test";

import { summarizeTaskEvent } from "../../apps/web/src/runtime/event-debug.ts";

test("summarizes OpenCode raw events for debug panel", () => {
  const summary = summarizeTaskEvent({
    id: "evt_1",
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.updated",
    messageId: "msg_1",
    timestamp: "2026-06-29T10:00:00.000Z",
    raw: { payload: { type: "message.part.updated" } },
  });

  assert.deepEqual(summary, {
    id: "evt_1",
    title: "message.part.updated",
    status: "running",
    messageId: "msg_1",
    timestamp: "2026-06-29T10:00:00.000Z",
    rawText: '{\n  "payload": {\n    "type": "message.part.updated"\n  }\n}',
  });
});

test("falls back to task event type when rawType is missing", () => {
  const summary = summarizeTaskEvent({
    type: "stream-error",
    status: "failed",
    message: "broken",
    timestamp: "2026-06-29T10:00:00.000Z",
  });

  assert.equal(summary.title, "stream-error");
  assert.equal(summary.rawText, "broken");
});
