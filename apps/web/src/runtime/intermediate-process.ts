import type { MessagePart, RunSummary, TranscriptMessage } from "../types";
import { formatElapsedTime } from "./time-format.ts";

export function finalVisibleStartIndex(parts: MessagePart[]) {
  const lastProcessIndex = lastProcessPartIndex(parts);
  const firstTextAfterProcess = parts.findIndex((part, index) => index > lastProcessIndex && isTextPart(part) && part.text.trim().length > 0);
  if (firstTextAfterProcess !== -1) {
    return firstTextAfterProcess;
  }

  return firstTextPartIndex(parts);
}

export function visiblePartEntries(message: TranscriptMessage) {
  const isRunning = message.runSummary?.status === "running" || message.runSummary?.status === "queued";
  const finalStartIndex = finalVisibleStartIndex(message.parts);

  return message.parts
    .map((part, index) => ({ part, index }))
    .filter(({ part, index }) => isRunning || (isAssistantMessage(message) ? index >= finalStartIndex && isTextPart(part) : isTextPart(part)));
}

export function intermediatePartEntries(message: TranscriptMessage | undefined) {
  if (!message) {
    return [];
  }

  const finalStartIndex = finalVisibleStartIndex(message.parts);
  return message.parts
    .map((part, index) => ({ part, index }))
    .filter(({ index }) => index < finalStartIndex);
}

export function hasIntermediateProcess(message: TranscriptMessage | undefined) {
  return intermediatePartEntries(message).length > 0;
}

export function isIntermediateProcessVisible(isRunning: boolean, isExpanded: boolean) {
  return isRunning || isExpanded;
}

export function shouldRenderIntermediatePart(part: MessagePart) {
  return part.type !== "reasoning" && part.type !== "session_status";
}

export function formatRunElapsed(summary: RunSummary | undefined, now: number) {
  if (!summary?.startedAt) {
    return "";
  }

  const startedAt = new Date(summary.startedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return "";
  }

  const endedAt = summary.completedAt ? new Date(summary.completedAt).getTime() : now;
  if (Number.isNaN(endedAt)) {
    return "";
  }

  const totalSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  if (summary.status !== "running" && summary.status !== "queued" && totalSeconds === 0) {
    return "<1s";
  }

  return formatElapsedTime(totalSeconds);
}

function firstTextPartIndex(parts: MessagePart[]) {
  return parts.findIndex((part) => isTextPart(part) && part.text.trim().length > 0);
}

function lastProcessPartIndex(parts: MessagePart[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isProcessPart(parts[index])) {
      return index;
    }
  }
  return -1;
}

function isProcessPart(part: MessagePart) {
  return part.type !== "text" && part.type !== "assistant_text" && part.type !== "reasoning" && part.type !== "session_status";
}
function isTextPart(part: MessagePart) {
  return part.type === "text" || part.type === "assistant_text";
}

function isAssistantMessage(message: TranscriptMessage) {
  return message.role === "assistant";
}
