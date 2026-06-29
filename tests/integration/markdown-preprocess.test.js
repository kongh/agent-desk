import assert from "node:assert/strict";
import test from "node:test";

import { normalizePipedMarkdownTables } from "../../apps/web/src/runtime/markdown-preprocess.ts";

test("normalizes flattened markdown pipe tables into gfm table blocks", () => {
  const input = "Now let me create a table.| 维度 | assistant-ui | Ant Design X | CopilotKit | |---|---|---|---| | 定位 | React Chat UI Toolkit | AI Interface Solution | Frontend Stack for Agents | | 开源协议 | MIT | MIT | MIT |";

  const output = normalizePipedMarkdownTables(input);

  assert.equal(
    output,
    [
      "Now let me create a table.",
      "",
      "| 维度 | assistant-ui | Ant Design X | CopilotKit |",
      "|---|---|---|---|",
      "| 定位 | React Chat UI Toolkit | AI Interface Solution | Frontend Stack for Agents |",
      "| 开源协议 | MIT | MIT | MIT |",
    ].join("\n"),
  );
});

test("leaves ordinary prose with pipe characters unchanged", () => {
  const input = "状态码 A | B 只是普通说明，不是表格。";

  assert.equal(normalizePipedMarkdownTables(input), input);
});
