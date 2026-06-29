import assert from "node:assert/strict";
import test from "node:test";

import { mapOpenCodeEventToTaskEvent } from "../../packages/opencode-runner/src/opencode-event-mapper.js";

test("mapOpenCodeEventToTaskEvent maps session and file events into readable task timeline events", () => {
  const context = {
    taskId: "task_1",
    sessionId: "ses_1",
    workspacePath: "/tmp/workspace",
  };

  const mapped = [
    mapOpenCodeEventToTaskEvent(
      {
        directory: "/tmp/workspace",
        payload: {
          type: "session.created",
          properties: {
            info: { id: "ses_1" },
          },
        },
      },
      context,
    ),
    mapOpenCodeEventToTaskEvent(
      {
        directory: "/tmp/workspace",
        payload: {
          type: "file.edited",
          properties: {
            file: "/tmp/workspace/output/report.md",
          },
        },
      },
      context,
    ),
    mapOpenCodeEventToTaskEvent(
      {
        directory: "/tmp/workspace",
        payload: {
          type: "session.idle",
          properties: {
            sessionID: "ses_1",
          },
        },
      },
      context,
    ),
  ];

  assert.deepEqual(
    mapped.map((event) => event?.type),
    ["opencode-session", "artifact", "opencode-idle"],
  );
  assert.equal(mapped[1].artifactPath, "output/report.md");
  assert.equal(mapped[2].status, "running");
});

test("mapOpenCodeEventToTaskEvent ignores other workspaces and sessions", () => {
  const context = {
    taskId: "task_1",
    sessionId: "ses_1",
    workspacePath: "/tmp/workspace",
  };

  assert.equal(
    mapOpenCodeEventToTaskEvent(
      {
        directory: "/tmp/other",
        payload: {
          type: "session.created",
          properties: {
            info: { id: "ses_1" },
          },
        },
      },
      context,
    ),
    null,
  );

  assert.equal(
    mapOpenCodeEventToTaskEvent(
      {
        directory: "/tmp/workspace",
        payload: {
          type: "session.idle",
          properties: {
            sessionID: "ses_other",
          },
        },
      },
      context,
    ),
    null,
  );
});

test("mapOpenCodeEventToTaskEvent maps tool and permission events", () => {
  const context = {
    taskId: "task_1",
    sessionId: "ses_1",
    workspacePath: "/tmp/workspace",
  };

  const toolEvent = mapOpenCodeEventToTaskEvent(
    {
      directory: "/tmp/workspace",
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            sessionID: "ses_1",
            tool: "write",
            state: {
              status: "running",
              input: {
                filePath: "output/report.md",
              },
            },
          },
        },
      },
    },
    context,
  );

  const permissionEvent = mapOpenCodeEventToTaskEvent(
    {
      directory: "/tmp/workspace",
      payload: {
        type: "permission.updated",
        properties: {
          sessionID: "ses_1",
          title: "允许写入文件",
        },
      },
    },
    context,
  );

  assert.equal(toolEvent.type, "tool");
  assert.match(toolEvent.message, /write/);
  assert.equal(toolEvent.raw.type, "message.part.updated");
  assert.equal(toolEvent.raw.properties.part.tool, "write");
  assert.equal(permissionEvent.type, "permission");
  assert.equal(permissionEvent.status, "running");
  assert.equal(permissionEvent.raw.type, "permission.updated");
});
