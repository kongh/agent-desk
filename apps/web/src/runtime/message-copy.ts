import type { MessagePart, TranscriptMessage } from "../types";

export function transcriptMessageToCopyText(message: TranscriptMessage) {
  return message.parts
    .map(partToCopyText)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function partToCopyText(part: MessagePart) {
  if (part.type === "text" || part.type === "assistant_text") {
    return part.text;
  }

  if (part.type === "reasoning" || part.type === "session_status") {
    return "";
  }

  if (part.type === "tool") {
    return [
      `工具：${part.tool}`,
      part.input === undefined ? "" : `输入：${stringify(part.input)}`,
      part.output === undefined ? "" : `输出：${stringify(part.output)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (part.type === "file") {
    return `文件变更：${part.file}`;
  }

  if (part.type === "permission") {
    return `权限请求：${part.title}`;
  }

  if (part.type === "error") {
    return part.message;
  }

  if (part.type === "raw_json") {
    return stringify(part.raw);
  }

  return stringify(part.event.raw ?? part.event);
}

function stringify(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
