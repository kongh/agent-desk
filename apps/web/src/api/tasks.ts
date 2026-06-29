import type { AgentProject, AgentTask, WorkspaceFile } from "../types";

type ApiErrorPayload = {
  error?: string;
};

async function readPayload<T>(response: Response): Promise<T & ApiErrorPayload> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return { error: await response.text() } as T & ApiErrorPayload;
}

export async function listTasks(): Promise<AgentTask[]> {
  const response = await fetch("/api/tasks");
  const payload = await readPayload<{ tasks?: AgentTask[] }>(response);
  return response.ok ? (payload.tasks ?? []) : [];
}

export async function listProjects(): Promise<AgentProject[]> {
  const response = await fetch("/api/projects");
  const payload = await readPayload<{ projects?: AgentProject[] }>(response);
  return response.ok ? (payload.projects ?? []) : [];
}

export async function createProject(name: string): Promise<AgentProject> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const payload = await readPayload<{ project?: AgentProject }>(response);

  if (!response.ok || !payload.project) {
    throw new Error(payload.error ?? "项目创建失败");
  }

  return payload.project;
}

export async function renameProject(projectId: string, name: string): Promise<{ project: AgentProject; tasks: AgentTask[] }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const payload = await readPayload<{ project?: AgentProject; tasks?: AgentTask[] }>(response);

  if (!response.ok || !payload.project) {
    throw new Error(payload.error ?? "项目重命名失败");
  }

  return { project: payload.project, tasks: payload.tasks ?? [] };
}

export async function createTask(prompt: string, projectId?: string): Promise<AgentTask> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, agent: "general", projectId }),
  });
  const payload = await readPayload<{ task?: AgentTask }>(response);

  if (!response.ok || !payload.task) {
    throw new Error(payload.error ?? "任务创建失败");
  }

  return payload.task;
}

export async function renameTask(taskId: string, title: string): Promise<AgentTask> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const payload = await readPayload<{ task?: AgentTask }>(response);

  if (!response.ok || !payload.task) {
    throw new Error(payload.error ?? "会话重命名失败");
  }

  return payload.task;
}

export async function sendTaskMessage(taskId: string, prompt: string): Promise<{ task: AgentTask; messageId?: string }> {
  const response = await fetch(`/api/tasks/${taskId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const payload = await readPayload<{ task?: AgentTask; message?: { id?: string } }>(response);

  if (!response.ok || !payload.task) {
    throw new Error(payload.error ?? "消息发送失败");
  }

  return { task: payload.task, messageId: payload.message?.id };
}

export async function loadReport(taskId: string): Promise<string> {
  const response = await fetch(`/api/tasks/${taskId}/report`);
  const payload = await readPayload<{ report?: string }>(response);
  return response.ok ? (payload.report ?? "") : (payload.error ?? "产物暂不可用");
}

export async function loadFiles(taskId: string): Promise<WorkspaceFile[]> {
  const response = await fetch(`/api/tasks/${taskId}/files`);
  const payload = await readPayload<{ files?: WorkspaceFile[] }>(response);
  return response.ok ? (payload.files ?? []) : [];
}

export async function loadFileContent(taskId: string, path: string): Promise<string> {
  const response = await fetch(`/api/tasks/${taskId}/files/content?path=${encodeURIComponent(path)}`);
  const payload = await readPayload<{ content?: string }>(response);
  return response.ok ? (payload.content ?? "") : (payload.error ?? "文件读取失败");
}

export function subscribeTaskEvents(
  taskId: string,
  onEvent: (event: MessageEvent) => void,
  onError: () => void,
  afterEventId?: string,
) {
  const suffix = afterEventId ? `?after=${encodeURIComponent(afterEventId)}` : "";
  const source = new EventSource(`/api/tasks/${taskId}/events${suffix}`);
  source.addEventListener("task-event", onEvent);
  source.onerror = onError;
  return source;
}
