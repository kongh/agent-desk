import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class TaskStore {
  #tasks = new Map();
  #subscribers = new Map();
  #filePath;
  #writeQueue = Promise.resolve();

  constructor({ filePath, tasks = [] } = {}) {
    this.#filePath = filePath;

    for (const task of tasks) {
      this.#tasks.set(task.id, task);
    }
  }

  static async open(filePath) {
    let tasks = [];

    try {
      const payload = JSON.parse(await readFile(filePath, "utf8"));
      tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    return new TaskStore({ filePath, tasks });
  }

  create(task) {
    this.#tasks.set(task.id, {
      ...task,
      status: "queued",
      events: [],
      messages: task.messages ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.#persistSoon();
    return this.get(task.id);
  }

  get(taskId) {
    return this.#tasks.get(taskId) ?? null;
  }

  list() {
    return [...this.#tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    const payload = JSON.stringify({ tasks: this.list() }, null, 2);
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
