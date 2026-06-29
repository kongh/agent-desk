import assert from "node:assert/strict";
import test from "node:test";

import {
  finalVisibleStartIndex,
  formatRunElapsed,
  hasIntermediateProcess,
  intermediatePartEntries,
  isIntermediateProcessVisible,
  shouldRenderIntermediatePart,
  visiblePartEntries,
} from "../../apps/web/src/runtime/intermediate-process.ts";

test("uses all text after the last process part as the completed visible answer", () => {
  const message = {
    id: "assistant-1",
    role: "assistant",
    runSummary: { status: "completed", actions: [] },
    parts: [
      { type: "assistant_text", text: "I will search first." },
      { type: "tool", tool: "websearch", input: { query: "agent ui" } },
      { type: "assistant_text", text: "Final answer part 1" },
      { type: "assistant_text", text: "Final answer part 2" },
    ],
  };

  assert.equal(finalVisibleStartIndex(message.parts), 2);
  assert.deepEqual(visiblePartEntries(message).map(({ index }) => index), [2, 3]);
  assert.deepEqual(intermediatePartEntries(message).map(({ index }) => index), [0, 1]);
});

test("shows all text when no process part exists", () => {
  const message = {
    id: "assistant-1",
    role: "assistant",
    runSummary: { status: "completed", actions: [] },
    parts: [
      { type: "assistant_text", text: "Answer part 1" },
      { type: "assistant_text", text: "Answer part 2" },
    ],
  };

  assert.deepEqual(visiblePartEntries(message).map(({ index }) => index), [0, 1]);
  assert.deepEqual(intermediatePartEntries(message).map(({ index }) => index), []);
});

test("keeps all parts visible while running", () => {
  const message = {
    id: "assistant-1",
    role: "assistant",
    runSummary: { status: "running", actions: [] },
    parts: [
      { type: "assistant_text", text: "I will search first." },
      { type: "tool", tool: "websearch" },
      { type: "assistant_text", text: "Streaming answer" },
    ],
  };

  assert.deepEqual(visiblePartEntries(message).map(({ index }) => index), [0, 1, 2]);
});

test("shows intermediate process while running and hides it by default when complete", () => {
  assert.equal(isIntermediateProcessVisible(true, false), true);
  assert.equal(isIntermediateProcessVisible(false, false), false);
  assert.equal(isIntermediateProcessVisible(false, true), true);
});

test("detects intermediate process before the final answer", () => {
  assert.equal(
    hasIntermediateProcess({
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "thinking" },
        { type: "assistant_text", text: "final answer" },
      ],
      runSummary: { status: "completed", actions: [] },
    }),
    true,
  );

  assert.equal(
    hasIntermediateProcess({
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "assistant_text", text: "final answer" }],
      runSummary: { status: "completed", actions: [] },
    }),
    false,
  );
});

test("does not render reasoning as visible intermediate content", () => {
  assert.equal(shouldRenderIntermediatePart({ type: "reasoning", text: "hidden" }), false);
  assert.equal(shouldRenderIntermediatePart({ type: "tool", tool: "websearch" }), true);
  assert.equal(shouldRenderIntermediatePart({ type: "assistant_text", text: "process text" }), true);
});

test("shows sub-second completed durations", () => {
  assert.equal(formatRunElapsed({ status: "completed", startedAt: "2026-06-29T10:00:00.000Z", completedAt: "2026-06-29T10:00:00.000Z", actions: [] }, Date.now()), "<1s");
  assert.equal(formatRunElapsed({ status: "completed", startedAt: "2026-06-29T10:00:00.000Z", completedAt: "2026-06-29T10:00:02.000Z", actions: [] }, Date.now()), "2s");
});
