import assert from "node:assert/strict";
import test from "node:test";

import { transcriptMessageToCopyText } from "../../apps/web/src/runtime/message-copy.ts";

test("copies readable text from transcript message parts", () => {
  const text = transcriptMessageToCopyText({
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "assistant_text", text: "答案" },
      { type: "reasoning", text: "内部思考" },
      { type: "tool", tool: "websearch", input: { q: "agent ui" }, output: { ok: true } },
      { type: "error", message: "失败" },
    ],
  });

  assert.equal(text, "答案\n\n工具：websearch\n输入：{\n  \"q\": \"agent ui\"\n}\n输出：{\n  \"ok\": true\n}\n\n失败");
});

test("copies user text without extra labels", () => {
  const text = transcriptMessageToCopyText({
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "你好" }],
  });

  assert.equal(text, "你好");
});
