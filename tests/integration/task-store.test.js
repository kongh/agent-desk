import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TaskStore } from "../../apps/api/src/task-store.js";

test("TaskStore persists tasks and events to a JSON file", async () => {
  const root = await mkdtemp(join(tmpdir(), "task-store-test-"));
  const filePath = join(root, "tasks.json");

  try {
    const store = await TaskStore.open(filePath);
    store.create({
      id: "task_1",
      prompt: "调研 AI 助手",
      agent: "deep-research",
      workspace: {
        id: "run_1",
        path: "/tmp/run_1",
        dirs: {
          input: "/tmp/run_1/input",
          sources: "/tmp/run_1/sources",
          notes: "/tmp/run_1/notes",
          output: "/tmp/run_1/output",
          logs: "/tmp/run_1/logs",
        },
      },
    });
    store.appendEvent("task_1", {
      type: "completed",
      status: "completed",
      title: "完成",
      message: "任务完成",
      timestamp: "2026-06-28T00:00:00.000Z",
    });
    await store.flush();

    const restored = await TaskStore.open(filePath);
    const task = restored.get("task_1");

    assert.equal(task.status, "completed");
    assert.equal(task.prompt, "调研 AI 助手");
    assert.equal(task.events.length, 1);
    assert.equal(task.events[0].id, "evt_1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
