import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTaskWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
} from "../../../packages/agent-workspace/src/workspace.js";
import { createAgentRunner } from "../../../packages/opencode-runner/src/runner-factory.js";
import { TaskStore } from "./task-store.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const defaultWebRoot = join(repoRoot, "apps/web/dist");
const fallbackWebRoot = join(repoRoot, "apps/web/public");
const defaultWorkspaceRoot = join(repoRoot, "workspaces");
const defaultTaskStoreFile = join(repoRoot, "data/tasks.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createApiServer({
  workspaceRoot = process.env.WORKSPACES_DIR || defaultWorkspaceRoot,
  webRoot = process.env.WEB_ROOT || defaultWebRoot,
  runner = createAgentRunner(),
  store = new TaskStore(),
} = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, {
          ok: true,
          cwd: process.cwd(),
          runnerMode: process.env.AGENT_RUNNER ?? "mock",
          workspaceRoot,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/tasks") {
        return sendJson(response, 200, { tasks: store.list() });
      }

      if (request.method === "POST" && url.pathname === "/api/tasks") {
        const body = await readJsonBody(request);
        const prompt = String(body.prompt ?? "").trim();
        const agent = String(body.agent ?? "deep-research");

        if (!prompt) {
          return sendJson(response, 400, { error: "任务内容不能为空" });
        }

        const workspace = await createTaskWorkspace(workspaceRoot, prompt);
        const task = store.create({
          id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          prompt,
          agent,
          workspace,
          messages: [
            {
              id: "msg_1",
              role: "user",
              text: prompt,
              timestamp: new Date().toISOString(),
            },
          ],
        });

        queueMicrotask(() => {
          runner
            .runResearchTask({
              taskId: task.id,
              prompt,
              workspace,
              messageId: task.messages[0].id,
              onEvent: (event) => store.appendEvent(task.id, event),
            })
            .catch((error) => {
              store.appendEvent(task.id, {
                type: "failed",
                status: "failed",
                title: "任务失败",
                message: stripAnsi(error.message),
                timestamp: new Date().toISOString(),
              });
            });
        });

        return sendJson(response, 201, { task });
      }

      const taskMessageMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/messages$/);
      if (request.method === "POST" && taskMessageMatch) {
        const task = store.get(taskMessageMatch[1]);
        if (!task) {
          return sendJson(response, 404, { error: "任务不存在" });
        }

        const body = await readJsonBody(request);
        const prompt = String(body.prompt ?? "").trim();
        if (!prompt) {
          return sendJson(response, 400, { error: "消息内容不能为空" });
        }

        const message = store.appendMessage(task.id, {
          role: "user",
          text: prompt,
        });

        queueMicrotask(() => {
          runner
            .runResearchTask({
              taskId: task.id,
              prompt,
              workspace: task.workspace,
              messageId: message.id,
              onEvent: (event) => store.appendEvent(task.id, event),
            })
            .catch((error) => {
              store.appendEvent(task.id, {
                type: "failed",
                status: "failed",
                title: "任务失败",
                message: stripAnsi(error.message),
                timestamp: new Date().toISOString(),
              });
            });
        });

        return sendJson(response, 202, { task: store.get(task.id), message });
      }

      const taskReportMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/report$/);
      if (request.method === "GET" && taskReportMatch) {
        const task = store.get(taskReportMatch[1]);
        if (!task) {
          return sendJson(response, 404, { error: "任务不存在" });
        }

        try {
          const report = await readWorkspaceFile(task.workspace, "output/report.md");
          return sendJson(response, 200, { report });
        } catch {
          return sendJson(response, 404, { error: "报告尚未生成" });
        }
      }

      const taskFilesMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/files$/);
      if (request.method === "GET" && taskFilesMatch) {
        const task = store.get(taskFilesMatch[1]);
        if (!task) {
          return sendJson(response, 404, { error: "任务不存在" });
        }

        const files = await listWorkspaceFiles(task.workspace);
        return sendJson(response, 200, { files });
      }

      const taskFileContentMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/files\/content$/);
      if (request.method === "GET" && taskFileContentMatch) {
        const task = store.get(taskFileContentMatch[1]);
        if (!task) {
          return sendJson(response, 404, { error: "任务不存在" });
        }

        const filePath = String(url.searchParams.get("path") ?? "").trim();
        if (!filePath) {
          return sendJson(response, 400, { error: "文件路径不能为空" });
        }

        try {
          const content = await readWorkspaceFile(task.workspace, filePath);
          return sendJson(response, 200, { path: filePath, content });
        } catch {
          return sendJson(response, 400, { error: "文件不存在或路径不合法" });
        }
      }

      const taskEventsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/events$/);
      if (request.method === "GET" && taskEventsMatch) {
        const task = store.get(taskEventsMatch[1]);
        if (!task) {
          return sendJson(response, 404, { error: "任务不存在" });
        }

        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });

        const send = (event) => {
          response.write(`event: task-event\n`);
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        const afterEventId = url.searchParams.get("after");
        const unsubscribe = store.subscribe(task.id, send, { afterEventId });
        request.on("close", unsubscribe);
        return;
      }

      return serveStatic(url.pathname, response, webRoot);
    } catch (error) {
      return sendJson(response, 500, { error: error.message });
    }
  });
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, "").trim();
}

export function listen() {
  const port = Number(process.env.API_PORT ?? 3001);
  const host = process.env.API_HOST ?? "127.0.0.1";
  const taskStoreFile = process.env.TASK_STORE_FILE || defaultTaskStoreFile;

  return TaskStore.open(taskStoreFile).then((store) => {
    const server = createApiServer({ store });

    server.listen(port, host, () => {
      console.log(`业务智能体 MVP 已启动：http://${host}:${port}`);
    });

    return server;
  });
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function serveStatic(pathname, response, webRoot) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const root = await resolveWebRoot(webRoot);
  const target = resolve(root, `.${cleanPath}`);

  if (!target.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    await readFile(target);
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(target)] ?? "application/octet-stream",
  });
  createReadStream(target).pipe(response);
}

async function resolveWebRoot(webRoot) {
  try {
    await readFile(join(webRoot, "index.html"));
    return webRoot;
  } catch {
    return fallbackWebRoot;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  listen().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
