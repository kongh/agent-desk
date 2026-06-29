import { createOpencodeClient } from "@opencode-ai/sdk";

import { readWorkspaceFile, writeWorkspaceFile } from "../../agent-workspace/src/workspace.js";

export class OpenCodeSdkRunner {
  constructor({
    baseUrl = process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096",
    createClient = createOpencodeClient,
    model = parseModel(process.env.OPENCODE_MODEL),
    promptTimeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS ?? 120_000),
  } = {}) {
    this.baseUrl = baseUrl;
    this.createClient = createClient;
    this.model = model;
    this.promptTimeoutMs = promptTimeoutMs;
    this.sessionsByTask = new Map();
  }

  async runResearchTask({ taskId, prompt, workspace, messageId, onEvent }) {
    const emit = async (event) => {
      await onEvent({
        taskId,
        messageId,
        timestamp: new Date().toISOString(),
        ...event,
      });
    };

    const { client, sessionId } = await this.getOrCreateSession({ taskId, prompt, workspace, emit });

    const eventSubscription = subscribeToOpenCodeEvents({
      client,
      taskId,
      sessionId,
      workspace,
      emit,
    });

    const body = {
      parts: [
        {
          type: "text",
          text: prompt,
        },
      ],
    };

    if (this.model) {
      body.model = this.model;
    }

    let promptResponse;
    const promptAbortController = new AbortController();
    const promptTimeout = setTimeout(() => {
      promptAbortController.abort(
        new Error(`OpenCode prompt timed out after ${this.promptTimeoutMs}ms`),
      );
    }, this.promptTimeoutMs);

    try {
      promptResponse = await client.session.prompt({
        path: {
          id: sessionId,
        },
        body,
        signal: promptAbortController.signal,
      });
      await eventSubscription.drain();
    } finally {
      clearTimeout(promptTimeout);
      eventSubscription.close();
    }

    const promptResult = unwrapData(promptResponse);
    const promptError = promptResult?.info?.error;
    if (promptError) {
      await emit(rawEvent({
        rawType: "sdk.session.prompt.error",
        raw: promptResponse,
        status: "failed",
      }));
      throw new Error(formatOpenCodeError(promptError));
    }

    await ensureReportExists({ workspace, prompt, result: promptResult });

    await emit(rawEvent({
      rawType: "sdk.session.prompt.result",
      raw: promptResponse,
      status: "completed",
    }));
  }

  async getOrCreateSession({ taskId, prompt, workspace, emit }) {
    const existing = this.sessionsByTask.get(taskId);
    if (existing) {
      return existing;
    }

    const client = this.createClient({
      baseUrl: this.baseUrl,
      directory: workspace.path,
    });

    const sessionResponse = await client.session.create({
      body: {
        title: prompt,
      },
    });
    const session = unwrapData(sessionResponse);
    const sessionId = session?.id;

    if (!sessionId) {
      throw new Error("OpenCode SDK did not return a session id");
    }

    const next = {
      client,
      sessionId,
      workspacePath: workspace.path,
    };
    this.sessionsByTask.set(taskId, next);

    await emit(rawEvent({
      rawType: "sdk.session.create",
      raw: sessionResponse,
    }));

    return next;
  }
}

function subscribeToOpenCodeEvents({ client, taskId, sessionId, workspace, emit }) {
  if (!client.global?.event) {
    return noopSubscription();
  }

  const abortController = new AbortController();
  let stream;

  try {
    stream = client.global.event({
      signal: abortController.signal,
      sseMaxRetryAttempts: 1,
    })?.stream;
  } catch {
    return noopSubscription();
  }

  if (!stream?.[Symbol.asyncIterator]) {
    return noopSubscription();
  }

  const drainPromise = (async () => {
    for await (const openCodeEvent of stream) {
      if (belongsToWorkspace(openCodeEvent, workspace.path) && belongsToSession(openCodeEvent?.payload, sessionId)) {
        await emit(rawEvent({
          rawType: openCodeEvent.payload?.type ?? "opencode.event",
          raw: openCodeEvent,
          status: eventStatus(openCodeEvent),
        }));
      }
    }
  })();

  drainPromise.catch(() => {});

  return {
    async drain() {
      await Promise.race([drainPromise, sleep(100)]);
    },
    close() {
      abortController.abort();
    },
  };
}

function rawEvent({ rawType, raw, status = "running" }) {
  return {
    type: "opencode-raw",
    status,
    rawType,
    raw,
  };
}

function belongsToWorkspace(openCodeEvent, workspacePath) {
  return !openCodeEvent?.directory || openCodeEvent.directory === workspacePath;
}

function belongsToSession(payload, sessionId) {
  const eventSessionId =
    payload?.properties?.sessionID ??
    payload?.properties?.info?.id ??
    payload?.properties?.part?.sessionID ??
    payload?.properties?.permission?.sessionID;

  return !eventSessionId || eventSessionId === sessionId;
}

function eventStatus(openCodeEvent) {
  const payload = openCodeEvent?.payload;
  const status = payload?.properties?.part?.state?.status ?? payload?.status;

  if (status === "error" || payload?.type === "session.error") {
    return "failed";
  }

  return "running";
}

function noopSubscription() {
  return {
    async drain() {},
    close() {},
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseModel(model) {
  if (!model) {
    return undefined;
  }

  const [providerID, ...modelParts] = model.split("/");
  const modelID = modelParts.join("/");

  if (!providerID || !modelID) {
    return undefined;
  }

  return {
    providerID,
    modelID,
  };
}

function unwrapData(response) {
  return response?.data ?? response;
}

function formatOpenCodeError(error) {
  const name = error.name ?? "OpenCodeError";
  const message = error.data?.message ?? error.message ?? JSON.stringify(error);
  return `${name}: ${message}`;
}

async function ensureReportExists({ workspace, prompt, result }) {
  try {
    await readWorkspaceFile(workspace, "output/report.md");
  } catch {
    await writeWorkspaceFile(
      workspace,
      "output/report.md",
      [
        `# ${prompt}`,
        "",
        "## 执行结果",
        "",
        "OpenCode SDK 已完成调用，但没有生成 `output/report.md`。系统已生成兜底报告，便于继续调试 SDK 接入。",
        "",
        "## SDK 返回",
        "",
        "```json",
        JSON.stringify(result ?? null, null, 2),
        "```",
        "",
      ].join("\n"),
    );
  }
}
