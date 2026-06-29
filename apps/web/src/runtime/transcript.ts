import type { AgentSessionView, AgentTask, MessagePart, RunAction, TaskEvent, TaskStatus, TranscriptMessage } from "../types";
import { describeOpenCodeEvent } from "./opencode-renderer.ts";

export function createEmptySession(): AgentSessionView {
  return {
    status: "idle",
    title: "待命",
    summary: "OpenCode 原始事件会直接流式显示。",
    messages: [],
  };
}

export function createPendingSession(prompt: string): AgentSessionView {
  const id = localMessageId();
  return {
    status: "running",
    title: "连接中",
    summary: "正在等待 OpenCode 事件流。",
    messages: [
      ...createEmptySession().messages,
      userMessage(prompt, id),
      rawStreamMessage([], id),
    ],
  };
}

export function hydrateTaskSession(task: AgentTask): AgentSessionView {
  return buildSession({
    prompt: task.prompt,
    messages: task.messages ?? [],
    status: task.status,
    events: task.events ?? [],
    createdAt: task.createdAt,
  });
}

export function appendUserMessage(session: AgentSessionView, prompt: string, messageId = localMessageId()): AgentSessionView {
  return {
    ...session,
    status: "running",
    title: "连接中",
    summary: "正在等待 OpenCode 事件流。",
    messages: [
      ...session.messages,
      userMessage(prompt, messageId),
      rawStreamMessage([], messageId),
    ],
  };
}

export function appendTaskEvent(session: AgentSessionView, event: TaskEvent): AgentSessionView {
  if (isSilentEvent(event)) {
    return {
      ...session,
      status: event.status,
      title: event.rawType ?? event.type,
      summary: event.status,
    };
  }

  const messages = upsertAssistantRunMessage(session.messages, event);
  return {
    ...session,
    status: event.status,
    title: event.rawType ?? event.type,
    summary: event.status,
    messages,
  };
}

function buildSession({
  prompt,
  messages,
  status,
  events,
  createdAt,
}: {
  prompt: string;
  messages: AgentTask["messages"];
  status: TaskStatus;
  events: TaskEvent[];
  createdAt?: string;
}): AgentSessionView {
  let session: AgentSessionView = {
    ...createEmptySession(),
    status,
    title: statusTitle(status),
    summary: taskSummary(status),
    messages: [...createEmptySession().messages, ...userMessages(prompt, createdAt, messages)],
  };

  for (const event of events) {
    session = appendTaskEvent(session, event);
  }

  if (status === "completed") {
    return session;
  }

  return session;
}

function userMessage(prompt: string, id = createdAtId(), createdAt?: string): TranscriptMessage {
  return {
    id: `user-${createdAt ?? id}`,
    role: "user",
    createdAt,
    parts: [{ type: "text", text: prompt }],
  };
}

function userMessages(prompt: string, createdAt?: string, messages: AgentTask["messages"] = []): TranscriptMessage[] {
  if (!messages.length) {
    return [userMessage(prompt, createdAt ?? createdAtId(), createdAt)];
  }

  return messages.flatMap((message) => {
    if (message.role !== "user") {
      return [];
    }

    return [
      userMessage(message.text, message.id, message.timestamp),
      rawStreamMessage([], message.id),
    ];
  });
}

function upsertAssistantRunMessage(messages: TranscriptMessage[], event: TaskEvent): TranscriptMessage[] {
  const runMessage = findRunMessage(messages, event.messageId);
  const nextParts = applyOpenCodeEvent(runMessage?.parts ?? [], event);
  const nextRunSummary = applyRunSummaryEvent(runMessage?.runSummary, event);

  if (!runMessage) {
    return [
      ...messages,
      {
        ...rawStreamMessage(nextParts, event.messageId ?? localMessageId()),
        runSummary: nextRunSummary,
      },
    ];
  }

  return messages.map((message) =>
    message.id === runMessage.id ? { ...message, parts: nextParts, runSummary: nextRunSummary } : message,
  );
}

function applyRunSummaryEvent(summary: TranscriptMessage["runSummary"] | undefined, event: TaskEvent) {
  const startedAt = summary?.startedAt ?? event.timestamp;
  const completedAt = event.status === "completed" || event.status === "failed" ? event.timestamp : summary?.completedAt;
  const next = {
    status: event.status,
    startedAt,
    completedAt,
    actions: [...(summary?.actions ?? [])],
  };
  const action = eventToRunAction(event);
  if (action && !next.actions.some((item) => item.id === action.id)) {
    next.actions.push(action);
  }

  return next;
}

function eventToRunAction(event: TaskEvent): RunAction | undefined {
  const model = describeOpenCodeEvent(event);

  if (model.kind === "tool") {
    return {
      id: event.id ?? `${event.rawType ?? "tool"}-${event.timestamp}`,
      kind: toolActionKind(model.tool),
      label: toolActionLabel(model.tool),
      target: extractActionTarget(model.input),
      status: model.status ?? event.status,
      rawType: model.rawType,
    };
  }

  if (model.kind === "file") {
    return {
      id: event.id ?? `file-${event.timestamp}`,
      kind: "write_file",
      label: "写入文件",
      target: model.file,
      status: event.status,
      rawType: model.rawType,
    };
  }

  if (model.kind === "permission") {
    return {
      id: event.id ?? `permission-${event.timestamp}`,
      kind: "permission",
      label: "权限请求",
      target: model.title,
      status: event.status,
      rawType: model.rawType,
    };
  }

  if (model.kind === "error") {
    return {
      id: event.id ?? `error-${event.timestamp}`,
      kind: "error",
      label: "执行出错",
      target: model.message,
      status: "failed",
      rawType: model.rawType,
    };
  }

  return undefined;
}

function toolActionKind(toolName: string): RunAction["kind"] {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("websearch") || normalized.includes("web_search") || normalized.includes("search")) return "web_search";
  if (normalized.includes("webfetch") || normalized.includes("fetch")) return "web_fetch";
  if (normalized.includes("write") || normalized.includes("edit")) return "write_file";
  if (normalized.includes("read")) return "read_file";
  if (normalized.includes("bash") || normalized.includes("command")) return "command";
  return "tool";
}

function toolActionLabel(toolName: string) {
  const kind = toolActionKind(toolName);
  const labels: Record<RunAction["kind"], string> = {
    web_search: "搜索网页",
    web_fetch: "读取网页",
    read_file: "读取文件",
    write_file: "写入文件",
    command: "运行命令",
    permission: "权限请求",
    error: "执行出错",
    tool: "工具调用",
  };
  return labels[kind];
}

function extractActionTarget(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const target = record.file ?? record.path ?? record.filePath ?? record.url ?? record.query ?? record.q ?? record.command;
  return typeof target === "string" && target.length > 0 ? target : undefined;
}

function findRunMessage(messages: TranscriptMessage[], messageId?: string) {
  if (messageId) {
    const exact = messages.find((message) => message.id === assistantRunId(messageId));
    if (exact) {
      return exact;
    }
  }

  return [...messages].reverse().find((message) => message.id.startsWith("assistant-run-"));
}

function applyOpenCodeEvent(parts: MessagePart[], event: TaskEvent): MessagePart[] {
  const model = describeOpenCodeEvent(event);

  if (model.kind === "hidden") {
    return parts;
  }

  if (model.kind === "text_delta") {
    return appendAssistantText(parts, model.text);
  }

  if (model.kind === "prompt_result") {
    const hasStreamedText = parts.some((part) => part.type === "assistant_text");
    return [
      ...parts,
      ...(!hasStreamedText && model.text ? [{ type: "assistant_text" as const, text: model.text }] : []),
      ...model.reasoning.map((text) => ({ type: "reasoning" as const, text })),
    ];
  }

  if (model.kind === "tool") {
    return upsertToolPart(parts, {
      type: "tool",
      id: model.id ?? stableToolPartId(model.tool, model.input),
      tool: model.tool,
      status: model.status,
      input: model.input,
      output: model.output,
      raw: model.raw,
    });
  }

  if (model.kind === "file") {
    return [...parts, { type: "file", file: model.file, raw: model.raw }];
  }

  if (model.kind === "permission") {
    return [...parts, { type: "permission", title: model.title, raw: model.raw }];
  }

  if (model.kind === "session_status") {
    return parts;
  }

  if (model.kind === "error") {
    return [...parts, { type: "error", message: model.message }];
  }

  return parts;
}

function isSilentEvent(event: TaskEvent) {
  return event.rawType === "sdk.session.create" || event.rawType === "sdk.event.subscribe.observed";
}

function upsertToolPart(parts: MessagePart[], nextTool: Extract<MessagePart, { type: "tool" }>): MessagePart[] {
  const existingIndex = parts.findIndex((part) => part.type === "tool" && part.id && nextTool.id && part.id === nextTool.id);
  if (existingIndex === -1) {
    return [...parts, nextTool];
  }

  return parts.map((part, index) => (index === existingIndex ? { ...part, ...nextTool } : part));
}

function stableToolPartId(tool: string, input: unknown) {
  return "tool:" + tool + ":" + stableStringify(input);
}

function stableStringify(value: unknown) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function appendAssistantText(parts: MessagePart[], text: string): MessagePart[] {
  const last = parts.at(-1);
  if (last?.type === "assistant_text") {
    return [...parts.slice(0, -1), { ...last, text: `${last.text}${text}` }];
  }

  return [...parts, { type: "assistant_text", text }];
}

function rawStreamMessage(parts: MessagePart[], id: string): TranscriptMessage {
  return {
    id: assistantRunId(id),
    role: "assistant",
    parts,
    runSummary: { status: "running", actions: [] },
  };
}

function assistantRunId(messageId: string) {
  return `assistant-run-${messageId}`;
}

function localMessageId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createdAtId() {
  return `${Date.now()}`;
}

export function statusTitle(status: TaskStatus) {
  const titles: Record<string, string> = {
    completed: "已完成",
    failed: "失败",
    running: "运行中",
    queued: "排队中",
    idle: "待命",
  };
  return titles[status] ?? status ?? "未知";
}

function taskSummary(status: TaskStatus) {
  if (status === "completed") {
    return "OpenCode 事件流已结束。";
  }

  if (status === "failed") {
    return "OpenCode 调用失败。";
  }

  return "等待 OpenCode 事件。";
}
