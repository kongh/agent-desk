import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ReadonlyJSONObject, ReadonlyJSONValue } from "assistant-stream/utils";

import type { MessagePart, TranscriptMessage } from "../types";

export function toAssistantUiMessages(messages: TranscriptMessage[]): ThreadMessageLike[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
    status: message.role === "assistant" && message.parts.length === 0
      ? { type: "running" as const }
      : message.role === "assistant"
        ? { type: "complete" as const, reason: "stop" as const }
        : undefined,
    content: message.parts.flatMap(toAssistantUiParts),
  }));
}

type AssistantUiPart = Exclude<ThreadMessageLike["content"], string>[number];

function toAssistantUiParts(part: MessagePart): AssistantUiPart[] {
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
        toolCallId: `tool-${part.tool}-${stableHash(part.raw ?? part.input ?? part.output ?? "")}`,
        toolName: part.tool,
        args: toRecord(part.input),
        argsText: stringify(part.input),
        result: part.output,
      },
    ];
  }

  if (part.type === "file") {
    return [{ type: "text", text: `文件变更：${part.file}` }];
  }

  if (part.type === "permission") {
    return [{ type: "text", text: `权限请求：${part.title}` }];
  }

  if (part.type === "error") {
    return [{ type: "text", text: part.message }];
  }

  if (part.type === "session_status") {
    return [];
  }

  if (part.type === "raw_json") {
    return [{ type: "text", text: `\`\`\`json\n${stringify(part.raw)}\n\`\`\`` }];
  }

  return [{ type: "text", text: `\`\`\`json\n${stringify(part.event.raw ?? part.event)}\n\`\`\`` }];
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
