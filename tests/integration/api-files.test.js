import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiServer } from "../../apps/api/src/server.js";
import { writeWorkspaceFile } from "../../packages/agent-workspace/src/workspace.js";

test("task file APIs list and read files inside the task workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-api-files-test-"));
  const runner = {
    async runResearchTask({ workspace, onEvent }) {
      await writeWorkspaceFile(workspace, "sources/source.md", "# 来源");
      await writeWorkspaceFile(workspace, "notes/analysis.md", "# 分析");
      await writeWorkspaceFile(workspace, "output/report.md", "# 报告");
      await onEvent({
        type: "completed",
        status: "completed",
        title: "任务完成",
        message: "测试任务完成",
        timestamp: new Date().toISOString(),
      });
    },
  };
  const server = createApiServer({ workspaceRoot: root, runner });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const health = await getJson(`${baseUrl}/api/health`);
    assert.equal(health.ok, true);
    assert.equal(health.workspaceRoot, root);

    const created = await postJson(`${baseUrl}/api/tasks`, {
      prompt: "验证工作区文件",
      agent: "deep-research",
    });
    const taskId = created.task.id;

    await waitForTaskCompletion(baseUrl, taskId);

    const fileList = await getJson(`${baseUrl}/api/tasks/${taskId}/files`);
    assert.deepEqual(
      fileList.files.map((file) => file.path),
      ["sources/source.md", "notes/analysis.md", "output/report.md"],
    );

    const content = await getJson(
      `${baseUrl}/api/tasks/${taskId}/files/content?path=sources%2Fsource.md`,
    );
    assert.equal(content.path, "sources/source.md");
    assert.equal(content.content, "# 来源");

    const escaped = await fetch(`${baseUrl}/api/tasks/${taskId}/files/content?path=..%2Fpackage.json`);
    assert.equal(escaped.status, 400);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("task message API appends follow-up prompts to the same task", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-api-followup-test-"));
  const calls = [];
  const runner = {
    async runResearchTask({ taskId, prompt, messageId, onEvent }) {
      calls.push({ taskId, prompt, messageId });
      await onEvent({
        type: "opencode-raw",
        status: "completed",
        rawType: "sdk.session.prompt.result",
        messageId,
        raw: {
          data: {
            info: {
              id: `msg_${calls.length}`,
            },
            parts: [{ type: "text", text: prompt }],
          },
        },
        timestamp: new Date().toISOString(),
      });
    },
  };
  const server = createApiServer({ workspaceRoot: root, runner });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const created = await postJson(`${baseUrl}/api/tasks`, {
      prompt: "第一句",
      agent: "general",
    });
    const taskId = created.task.id;
    await waitForTaskCompletion(baseUrl, taskId);

    const followup = await postJson(`${baseUrl}/api/tasks/${taskId}/messages`, {
      prompt: "第二句",
    });
    assert.equal(followup.task.id, taskId);
    await waitForTaskCompletion(baseUrl, taskId);

    const payload = await getJson(`${baseUrl}/api/tasks`);
    assert.equal(payload.tasks.length, 1);
    assert.deepEqual(payload.tasks[0].messages.map((message) => message.text), ["第一句", "第二句"]);
    assert.deepEqual(calls.map((call) => call.taskId), [taskId, taskId]);
    assert.deepEqual(calls.map((call) => call.prompt), ["第一句", "第二句"]);
    assert.deepEqual(calls.map((call) => call.messageId), ["msg_1", "msg_2"]);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  assert.equal(response.ok, true);
  return response.json();
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}

async function waitForTaskCompletion(baseUrl, taskId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const payload = await getJson(`${baseUrl}/api/tasks`);
    const task = payload.tasks.find((item) => item.id === taskId);

    if (task?.status === "completed") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for test task completion");
}
