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

export type AgentProject = {
  id: string;
  name: string;
};

export type AgentTask = {
  id: string;
  prompt: string;
  title?: string;
  agent: string;
  project?: AgentProject;
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
  runSummary?: RunSummary;
};

export type RunSummary = {
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
  actions: RunAction[];
};

export type RunAction = {
  id: string;
  kind: "web_search" | "web_fetch" | "read_file" | "write_file" | "command" | "permission" | "error" | "tool";
  label: string;
  target?: string;
  status?: TaskStatus;
  rawType?: string;
};

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id?: string; tool: string; status?: string; input?: unknown; output?: unknown; raw?: unknown }
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
