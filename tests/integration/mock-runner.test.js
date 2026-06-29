import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createTaskWorkspace } from "../../packages/agent-workspace/src/workspace.js";
import { MockOpenCodeRunner } from "../../packages/opencode-runner/src/mock-runner.js";

test("MockOpenCodeRunner emits a useful research timeline and writes deliverables", async () => {
  const root = await mkdtemp(join(tmpdir(), "mock-runner-test-"));

  try {
    const workspace = await createTaskWorkspace(root, "调研企业 AI 助手");
    const runner = new MockOpenCodeRunner();
    const events = [];

    await runner.runResearchTask({
      taskId: "task_1",
      prompt: "调研企业 AI 助手",
      workspace,
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(
      events.map((event) => event.type),
      ["started", "plan", "tool", "artifact", "artifact", "completed"],
    );

    assert.equal(events.at(-1).status, "completed");

    const report = await readFile(join(workspace.path, "output/report.md"), "utf8");
    assert.match(report, /调研企业 AI 助手/);
    assert.match(report, /来源/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
