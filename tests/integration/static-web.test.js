import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiServer } from "../../apps/api/src/server.js";

test("api server serves built web assets from a configurable web root", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-static-web-test-"));
  const webRoot = join(root, "dist");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await writeFile(join(webRoot, "index.html"), '<div id="root"></div><script src="/assets/app.js"></script>');
  await writeFile(join(webRoot, "assets/app.js"), "window.__agentWeb = true;");

  const server = createApiServer({
    workspaceRoot: join(root, "workspaces"),
    webRoot,
    runner: { async runResearchTask() {} },
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await index.text(), '<div id="root"></div><script src="/assets/app.js"></script>');

    const script = await fetch(`${baseUrl}/assets/app.js`);
    assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(await script.text(), "window.__agentWeb = true;");
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("api server creates tasks with default project metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-api-project-test-"));
  const server = createApiServer({
    workspaceRoot: join(root, "workspaces"),
    webRoot: join(root, "dist"),
    runner: { async runResearchTask() {} },
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "验证项目元数据", agent: "general" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(payload.task.project, { id: "agent-desk", name: "agent-desk" });
    assert.equal(payload.task.workspace.title, "验证项目元数据");
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("api server manages projects and session titles", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-api-project-management-test-"));
  const server = createApiServer({
    workspaceRoot: join(root, "workspaces"),
    webRoot: join(root, "dist"),
    runner: { async runResearchTask() {} },
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "知识图谱" }),
    });
    const projectPayload = await projectResponse.json();

    assert.equal(projectResponse.status, 201);
    assert.equal(projectPayload.project.name, "知识图谱");

    const taskResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "新会话", projectId: projectPayload.project.id }),
    });
    const taskPayload = await taskResponse.json();
    assert.equal(taskPayload.task.project.id, projectPayload.project.id);

    const renameTaskResponse = await fetch(`${baseUrl}/api/tasks/${taskPayload.task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "重命名会话" }),
    });
    const renameTaskPayload = await renameTaskResponse.json();
    assert.equal(renameTaskPayload.task.title, "重命名会话");

    const renameProjectResponse = await fetch(`${baseUrl}/api/projects/${projectPayload.project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Knowledge Graphs" }),
    });
    const renameProjectPayload = await renameProjectResponse.json();
    assert.equal(renameProjectPayload.project.name, "Knowledge Graphs");
    assert.equal(renameProjectPayload.tasks[0].project.name, "Knowledge Graphs");
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
