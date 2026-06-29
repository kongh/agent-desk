export type TaskStatus = "queued" | "running" | "completed" | "failed" | "idle" | string;

export type TaskEvent = {
  id?: string;
  taskId?: string;
  timestamp: string;
  type: string;
  status: TaskStatus;
  title?: string;
  message?: string;
  artifactPath?: string;
  rawType?: string;
  raw?: unknown;
  messageId?: string;
};

export type TaskWorkspace = {
  id?: string;
  title?: string;
  path?: string;
};

export type AgentTask = {
  id: string;
  prompt: string;
  agent: string;
  workspace?: TaskWorkspace | string;
  status: TaskStatus;
  messages?: Array<{
    id: string;
    role: "user" | "assistant" | string;
    text: string;
    timestamp?: string;
  }>;
  events?: TaskEvent[];
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceFile = {
  path: string;
  kind: string;
  size: number;
};

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  createdAt?: string;
};

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; tool: string; status?: string; input?: unknown; output?: unknown; raw?: unknown }
  | { type: "file"; file: string; raw?: unknown }
  | { type: "permission"; title: string; raw?: unknown }
  | { type: "session_status"; label: string; raw?: unknown }
  | { type: "raw_json"; label: string; raw?: unknown }
  | { type: "raw_event"; event: TaskEvent }
  | { type: "error"; message: string };

export type AgentSessionView = {
  status: TaskStatus;
  title: string;
  summary: string;
  messages: TranscriptMessage[];
};
