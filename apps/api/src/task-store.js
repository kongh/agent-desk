import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_PROJECT = { id: "agent-desk", name: "agent-desk" };

export class TaskStore {
  #tasks = new Map();
  #projects = new Map();
  #subscribers = new Map();
  #filePath;
  #writeQueue = Promise.resolve();

  constructor({ filePath, tasks = [], projects = [] } = {}) {
    this.#filePath = filePath;

    this.#projects.set(DEFAULT_PROJECT.id, { ...DEFAULT_PROJECT });
    for (const project of projects) {
      const normalized = normalizeProject(project);
      this.#projects.set(normalized.id, normalized);
    }

    for (const task of tasks) {
      const normalizedTask = normalizeTask(task);
      this.#tasks.set(normalizedTask.id, normalizedTask);
      this.#projects.set(normalizedTask.project.id, normalizedTask.project);
    }
  }

  static async open(filePath) {
    let tasks = [];
    let projects = [];

    try {
      const payload = JSON.parse(await readFile(filePath, "utf8"));
      tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      projects = Array.isArray(payload.projects) ? payload.projects : [];
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    return new TaskStore({ filePath, tasks, projects });
  }

  create(task) {
    const normalized = normalizeTask({
      ...task,
      status: "queued",
      events: [],
      messages: task.messages ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.#tasks.set(normalized.id, normalized);
    this.#projects.set(normalized.project.id, normalized.project);
    this.#persistSoon();
    return this.get(normalized.id);
  }

  get(taskId) {
    return this.#tasks.get(taskId) ?? null;
  }

  list() {
    return [...this.#tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listProjects() {
    return [...this.#projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  createProject(project) {
    const normalized = normalizeProject(project);
    if (this.#projects.has(normalized.id)) {
      throw new Error(`Project already exists: ${normalized.id}`);
    }
    this.#projects.set(normalized.id, normalized);
    this.#persistSoon();
    return normalized;
  }

  renameProject(projectId, name) {
    const project = this.#projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const nextProject = normalizeProject({ ...project, name });
    this.#projects.set(projectId, nextProject);

    for (const [taskId, task] of this.#tasks.entries()) {
      if (task.project?.id === projectId) {
        this.#tasks.set(taskId, { ...task, project: nextProject, updatedAt: new Date().toISOString() });
      }
    }

    this.#persistSoon();
    return nextProject;
  }

  renameTask(taskId, title) {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const nextTitle = String(title ?? "").trim();
    if (!nextTitle) {
      throw new Error("Task title cannot be empty");
    }

    task.title = nextTitle;
    task.updatedAt = new Date().toISOString();
    this.#tasks.set(taskId, task);
    this.#persistSoon();
    return task;
  }

  appendEvent(taskId, event) {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const nextEvent = {
      id: `evt_${task.events.length + 1}`,
      ...event,
    };

    task.events.push(nextEvent);
    task.status = nextEvent.status ?? task.status;
    task.updatedAt = new Date().toISOString();
    this.#tasks.set(taskId, task);
    this.#persistSoon();

    for (const send of this.#subscribers.get(taskId) ?? []) {
      send(nextEvent);
    }

    return nextEvent;
  }

  appendMessage(taskId, message) {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const nextMessage = {
      id: `msg_${(task.messages?.length ?? 0) + 1}`,
      timestamp: new Date().toISOString(),
      ...message,
    };

    task.messages = [...(task.messages ?? []), nextMessage];
    task.status = "running";
    task.updatedAt = new Date().toISOString();
    this.#tasks.set(taskId, task);
    this.#persistSoon();
    return nextMessage;
  }

  subscribe(taskId, send, { afterEventId } = {}) {
    const task = this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const subscribers = this.#subscribers.get(taskId) ?? new Set();
    subscribers.add(send);
    this.#subscribers.set(taskId, subscribers);

    for (const event of eventsAfter(task.events, afterEventId)) {
      send(event);
    }

    return () => {
      subscribers.delete(send);
      if (subscribers.size === 0) {
        this.#subscribers.delete(taskId);
      }
    };
  }

  #persistSoon() {
    if (!this.#filePath) {
      return;
    }

    this.#writeQueue = this.#writeQueue.then(() => this.#persist());
    this.#writeQueue.catch(() => {});
  }

  async flush() {
    await this.#writeQueue;
  }

  async #persist() {
    const payload = JSON.stringify({ projects: this.listProjects(), tasks: this.list() }, null, 2);
    const tempPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;

    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(tempPath, `${payload}\n`, "utf8");
    await rename(tempPath, this.#filePath);
  }
}

function eventsAfter(events, afterEventId) {
  if (!afterEventId) {
    return events;
  }

  const index = events.findIndex((event) => event.id === afterEventId);
  if (index < 0) {
    return events;
  }

  return events.slice(index + 1);
}

function normalizeTask(task) {
  return {
    ...task,
    project: normalizeProject(task.project),
    title: normalizeTaskTitle(task),
    messages: task.messages ?? [],
    events: task.events ?? [],
  };
}

function normalizeProject(project) {
  if (project && typeof project === "object") {
    const id = String(project.id ?? project.name ?? DEFAULT_PROJECT.id).trim() || DEFAULT_PROJECT.id;
    const name = String(project.name ?? project.id ?? DEFAULT_PROJECT.name).trim() || DEFAULT_PROJECT.name;
    return { id, name };
  }

  return { ...DEFAULT_PROJECT };
}

function normalizeTaskTitle(task) {
  const title = String(task.title ?? task.prompt ?? "").trim();
  return title || "新会话";
}

export function createProjectId(name) {
  const slug = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `project_${Date.now().toString(36)}`;
}
