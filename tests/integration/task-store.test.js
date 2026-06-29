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
    assert.deepEqual(task.project, { id: "agent-desk", name: "agent-desk" });
    assert.equal(task.events.length, 1);
    assert.equal(task.events[0].id, "evt_1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TaskStore preserves explicit project metadata", () => {
  const store = new TaskStore();

  const task = store.create({
    id: "task_project",
    prompt: "项目会话",
    agent: "general",
    project: { id: "zhiyuan-ontology", name: "zhiyuan-ontology" },
    workspace: { id: "run_2", path: "/tmp/run_2", dirs: {} },
  });

  assert.deepEqual(task.project, { id: "zhiyuan-ontology", name: "zhiyuan-ontology" });
});

test("TaskStore manages projects and task titles", () => {
  const store = new TaskStore();

  const project = store.createProject({ id: "knowledge-graphs", name: "knowledge-graphs" });
  const task = store.create({
    id: "task_kg",
    prompt: "原始问题",
    agent: "general",
    project,
    workspace: { id: "run_kg", path: "/tmp/run_kg", dirs: {} },
  });

  assert.equal(task.title, "原始问题");
  assert.equal(store.listProjects().some((item) => item.id === "knowledge-graphs"), true);

  const renamedProject = store.renameProject("knowledge-graphs", "Knowledge Graphs");
  const renamedTask = store.renameTask("task_kg", "新的会话名称");

  assert.deepEqual(renamedProject, { id: "knowledge-graphs", name: "Knowledge Graphs" });
  assert.equal(renamedTask.title, "新的会话名称");
  assert.equal(store.get("task_kg").project.name, "Knowledge Graphs");
});
