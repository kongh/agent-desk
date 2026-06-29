import type { TaskEvent } from "../types";

export type TaskEventDebugSummary = {
  id?: string;
  title: string;
  status: string;
  messageId?: string;
  timestamp: string;
  rawText: string;
};

export function summarizeTaskEvent(event: TaskEvent): TaskEventDebugSummary {
  return {
    id: event.id,
    title: event.rawType ?? event.type,
    status: event.status,
    messageId: event.messageId,
    timestamp: event.timestamp,
    rawText: event.raw === undefined ? event.message ?? "" : stringify(event.raw),
  };
}

export function summarizeTaskEvents(events: TaskEvent[] = []) {
  return events.map(summarizeTaskEvent);
}

function stringify(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
