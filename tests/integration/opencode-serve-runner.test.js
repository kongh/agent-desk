import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createTaskWorkspace, readWorkspaceFile } from "../../packages/agent-workspace/src/workspace.js";
import { OpenCodeServeRunner } from "../../packages/opencode-runner/src/opencode-serve-runner.js";

test("OpenCodeServeRunner runs opencode in the task workspace and emits lifecycle events", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-runner-test-"));
  const calls = [];

  try {
    const workspace = await createTaskWorkspace(root, "调研知识管理智能体");
    const runner = new OpenCodeServeRunner({
      runCommand: async (command) => {
        calls.push(command);
        return {
          stdout: "OpenCode completed",
          stderr: "",
          code: 0,
        };
      },
    });
    const events = [];

    await runner.runResearchTask({
      taskId: "task_real_1",
      prompt: "调研知识管理智能体",
      workspace,
      onEvent: (event) => events.push(event),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, workspace.path);
    assert.equal(calls[0].args[0], "run");
    assert.equal(calls[0].args.includes("--dir"), true);
    assert.equal(calls[0].args.includes(workspace.path), true);
    assert.equal(calls[0].args.at(-1), "调研知识管理智能体");
    assert.doesNotMatch(calls[0].args.at(-1), /业务深度调研智能体/);

    assert.deepEqual(
      events.map((event) => event.type),
      ["started", "tool", "artifact", "completed"],
    );

    const report = await readWorkspaceFile(workspace, "output/report.md");
    assert.match(report, /调研知识管理智能体/);
    assert.match(report, /OpenCode completed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCodeServeRunner can attach to a running OpenCode server", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-runner-attach-test-"));
  const calls = [];

  try {
    const workspace = await createTaskWorkspace(root, "验证 attach 模式");
    const runner = new OpenCodeServeRunner({
      serverUrl: "http://127.0.0.1:4096",
      runCommand: async (command) => {
        calls.push(command);
        return {
          stdout: "Attached OpenCode completed",
          stderr: "",
          code: 0,
        };
      },
    });

    await runner.runResearchTask({
      taskId: "task_attach_1",
      prompt: "验证 attach 模式",
      workspace,
      onEvent: () => {},
    });

    assert.deepEqual(calls[0].args.slice(0, 4), [
      "run",
      "--attach",
      "http://127.0.0.1:4096",
      "--dir",
    ]);
    assert.equal(calls[0].args[4], workspace.path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCodeServeRunner forwards raw opencode json output when available", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-runner-json-test-"));

  try {
    const workspace = await createTaskWorkspace(root, "验证 raw 事件");
    const runner = new OpenCodeServeRunner({
      runCommand: async () => ({
        stdout: [
          JSON.stringify({
            type: "message.part.updated",
            properties: {
              part: {
                type: "tool",
                tool: "write",
                state: {
                  status: "completed",
                  input: {
                    filePath: "output/report.md",
                  },
                },
              },
            },
          }),
          JSON.stringify({
            type: "file.edited",
            properties: {
              file: join(workspace.path, "output/report.md"),
            },
          }),
        ].join("\n"),
        stderr: "",
        code: 0,
      }),
    });
    const events = [];

    await runner.runResearchTask({
      taskId: "task_raw_1",
      prompt: "验证 raw 事件",
      workspace,
      onEvent: (event) => events.push(event),
    });

    const rawEvents = events.filter((event) => event.type === "opencode-raw");
    assert.equal(rawEvents.length, 2);
    assert.equal(rawEvents[0].raw.type, "message.part.updated");
    assert.equal(rawEvents[1].raw.type, "file.edited");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
