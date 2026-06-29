import type { AgentSessionView, AgentTask, MessagePart, TaskEvent, TaskStatus, TranscriptMessage } from "../types";
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

  if (!runMessage) {
    return [
      ...messages,
      {
        ...rawStreamMessage(nextParts, event.messageId ?? localMessageId()),
      },
    ];
  }

  return messages.map((message) =>
    message.id === runMessage.id ? { ...message, parts: nextParts } : message,
  );
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

  if (model.kind === "text_delta") {
    return appendAssistantText(parts, model.text);
  }

  if (model.kind === "prompt_result") {
    return [
      ...parts,
      ...(model.text ? [{ type: "assistant_text" as const, text: model.text }] : []),
      ...model.reasoning.map((text) => ({ type: "reasoning" as const, text })),
    ];
  }

  if (model.kind === "tool") {
    return [
      ...parts,
      {
        type: "tool",
        tool: model.tool,
        status: model.status,
        input: model.input,
        output: model.output,
        raw: model.raw,
      },
    ];
  }

  if (model.kind === "file") {
    return [...parts, { type: "file", file: model.file, raw: model.raw }];
  }

  if (model.kind === "permission") {
    return [...parts, { type: "permission", title: model.title, raw: model.raw }];
  }

  if (model.kind === "session_status") {
    return [...parts, { type: "session_status", label: model.label, raw: model.raw }];
  }

  if (model.kind === "error") {
    return [...parts, { type: "error", message: model.message }];
  }

  return [...parts, { type: "raw_json", label: model.rawType, raw: model.raw }];
}

function isSilentEvent(event: TaskEvent) {
  return event.rawType === "sdk.session.create";
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
