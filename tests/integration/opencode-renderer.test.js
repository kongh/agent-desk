import assert from "node:assert/strict";
import test from "node:test";

import { describeOpenCodeEvent } from "../../apps/web/src/runtime/opencode-renderer.ts";

test("describes OpenCode text delta events", () => {
  const model = describeOpenCodeEvent({
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.updated",
    timestamp: "2026-06-28T10:00:00.000Z",
    raw: {
      payload: {
        type: "message.part.updated",
        properties: {
          delta: "hello",
        },
      },
    },
  });

  assert.equal(model.kind, "text_delta");
  assert.equal(model.text, "hello");
});

test("describes OpenCode tool events without business conversion", () => {
  const model = describeOpenCodeEvent({
    type: "opencode-raw",
    status: "running",
    rawType: "message.part.updated",
    timestamp: "2026-06-28T10:00:00.000Z",
    raw: {
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "write",
            state: {
              status: "running",
              input: {
                filePath: "README.md",
              },
            },
          },
        },
      },
    },
  });

  assert.equal(model.kind, "tool");
  assert.equal(model.tool, "write");
  assert.deepEqual(model.input, { filePath: "README.md" });
});

test("describes file and unknown events", () => {
  const fileModel = describeOpenCodeEvent({
    type: "opencode-raw",
    status: "running",
    rawType: "file.edited",
    timestamp: "2026-06-28T10:00:00.000Z",
    raw: {
      payload: {
        type: "file.edited",
        properties: {
          file: "/workspace/README.md",
        },
      },
    },
  });

  assert.equal(fileModel.kind, "file");
  assert.equal(fileModel.file, "/workspace/README.md");

  const rawModel = describeOpenCodeEvent({
    type: "opencode-raw",
    status: "completed",
    rawType: "sdk.session.prompt.result",
    timestamp: "2026-06-28T10:00:01.000Z",
    raw: {
      data: {
        info: {
          id: "msg_1",
        },
      },
    },
  });

  assert.equal(rawModel.kind, "prompt_result");
});

test("describes SDK prompt result as assistant transcript", () => {
  const model = describeOpenCodeEvent({
    type: "opencode-raw",
    status: "completed",
    rawType: "sdk.session.prompt.result",
    timestamp: "2026-06-28T10:00:01.000Z",
    raw: {
      data: {
        info: {
          modelID: "qwen-plus",
          providerID: "alibaba-cn",
          finish: "stop",
          cost: 0.001,
          tokens: {
            total: 100,
            input: 80,
            output: 20,
          },
        },
        parts: [
          {
            type: "step-start",
          },
          {
            type: "reasoning",
            text: "internal reasoning",
          },
          {
            type: "text",
            text: "final answer",
          },
          {
            type: "step-finish",
            reason: "stop",
            tokens: {
              total: 100,
            },
            cost: 0.001,
          },
        ],
      },
    },
  });

  assert.equal(model.kind, "prompt_result");
  assert.equal(model.text, "final answer");
  assert.deepEqual(model.reasoning, ["internal reasoning"]);
  assert.equal(model.steps.length, 2);
  assert.equal(model.meta.modelID, "qwen-plus");
  assert.equal(model.meta.tokens.total, 100);
});
