import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ReadonlyJSONObject, ReadonlyJSONValue } from "assistant-stream/utils";

import type { MessagePart, TranscriptMessage } from "../types";
import { visiblePartEntries } from "./intermediate-process.ts";

export function toAssistantUiMessages(messages: TranscriptMessage[]): ThreadMessageLike[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
    status: assistantMessageStatus(message),
    content: visiblePartEntries(message).flatMap(({ part, index }) => toAssistantUiParts(part, message.id, index)),
  }));
}

function assistantMessageStatus(message: TranscriptMessage): ThreadMessageLike["status"] {
  if (message.role !== "assistant") {
    return undefined;
  }

  if (message.runSummary?.status === "running" || message.runSummary?.status === "queued" || message.parts.length === 0) {
    return { type: "running" as const };
  }

  return { type: "complete" as const, reason: "stop" as const };
}

type AssistantUiPart = Exclude<ThreadMessageLike["content"], string>[number];

function toAssistantUiParts(part: MessagePart, messageId: string, partIndex: number): AssistantUiPart[] {
  if (part.type === "text" || part.type === "assistant_text") {
    return [{ type: "text", text: part.text }];
  }

  if (part.type === "reasoning") {
    return [{ type: "reasoning", text: part.text }];
  }

  if (part.type === "tool") {
    return [
      {
        type: "tool-call",
        toolCallId: part.id ?? createToolCallId(`tool-${part.tool}`, messageId, partIndex, part.raw ?? part.input ?? part.output ?? ""),
        toolName: part.tool,
        args: toRecord(part.input),
        argsText: stringify(part.input),
        result: part.output,
      },
    ];
  }

  if (part.type === "file") {
    return [
      {
        type: "tool-call",
        toolCallId: createToolCallId("file", messageId, partIndex, part.file),
        toolName: "file.edited",
        args: { file: part.file },
        argsText: stringify({ file: part.file }),
        result: part.raw,
      },
    ];
  }

  if (part.type === "permission") {
    return [
      {
        type: "tool-call",
        toolCallId: createToolCallId("permission", messageId, partIndex, part.title),
        toolName: "permission.request",
        args: { title: part.title },
        argsText: stringify({ title: part.title }),
        result: part.raw,
      },
    ];
  }

  if (part.type === "error") {
    return [
      {
        type: "tool-call",
        toolCallId: createToolCallId("error", messageId, partIndex, part.message),
        toolName: "opencode.error",
        args: {},
        argsText: "",
        result: { message: part.message },
      },
    ];
  }

  if (part.type === "session_status") {
    return [];
  }

  if (part.type === "raw_json") {
    return [
      {
        type: "tool-call",
        toolCallId: createToolCallId("raw", messageId, partIndex, part.raw ?? part.label),
        toolName: part.label || "opencode.raw",
        args: {},
        argsText: "",
        result: part.raw,
      },
    ];
  }

  return [
    {
      type: "tool-call",
      toolCallId: createToolCallId("event", messageId, partIndex, part.event.raw ?? part.event),
      toolName: part.event.rawType ?? part.event.type ?? "opencode.event",
      args: {},
      argsText: "",
      result: part.event.raw ?? part.event,
    },
  ];
}
function createToolCallId(prefix: string, messageId: string, partIndex: number, value: unknown) {
  return `${prefix}-${messageId}-${partIndex}-${stableHash(value)}`;
}

function toRecord(value: unknown): ReadonlyJSONObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, ReadonlyJSONValue>;
  }

  return {};
}

function stringify(value: unknown) {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function stableHash(value: unknown) {
  const text = stringify(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
