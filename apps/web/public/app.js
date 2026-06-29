const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#sendButton");
const newChatButton = document.querySelector("#newChatButton");
const messageList = document.querySelector("#messageList");
const timeline = document.querySelector("#timeline");
const report = document.querySelector("#report");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const statusHint = document.querySelector("#statusHint");
const eventCount = document.querySelector("#eventCount");
const taskList = document.querySelector("#taskList");
const refreshReport = document.querySelector("#refreshReport");
const fileList = document.querySelector("#fileList");
const fileCount = document.querySelector("#fileCount");

let activeTaskId = null;
let activeRunCard = null;
let eventSource = null;
let events = [];
let tasks = [];

sendButton.addEventListener("click", sendMessage);
promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    sendMessage();
  }
});

newChatButton.addEventListener("click", () => {
  eventSource?.close();
  activeTaskId = null;
  activeRunCard = null;
  resetInspector();
  resetMessages();
  setStatus("idle", "待命", "发送消息后会创建一个执行任务");
  promptInput.focus();
});

refreshReport.addEventListener("click", async () => {
  if (activeTaskId) {
    await loadReport(activeTaskId);
    await loadFiles(activeTaskId);
  }
});

await loadTasks();

async function sendMessage() {
  const prompt = promptInput.value.trim();

  if (!prompt || sendButton.disabled) {
    promptInput.focus();
    return;
  }

  eventSource?.close();
  activeTaskId = null;
  events = [];
  activeRunCard = null;
  resetInspector();
  appendMessage("user", prompt);
  activeRunCard = appendRunMessage({
    status: "running",
    title: "准备执行",
    summary: "我已收到，正在创建执行任务。",
  });
  promptInput.value = "";
  sendButton.disabled = true;
  refreshReport.disabled = true;
  setStatus("running", "任务创建中", "正在创建工作区和 OpenCode 执行上下文");

  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, agent: "general" }),
    });
    const payload = await readPayload(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "任务创建失败");
    }

    activeTaskId = payload.task.id;
    refreshReport.disabled = false;
    tasks = [payload.task, ...tasks.filter((task) => task.id !== payload.task.id)];
    renderTaskList();
    updateRunCard({
      status: "running",
      title: "任务已创建",
      summary: "正在等待 OpenCode 返回执行事件。",
    });
    subscribeToTask(activeTaskId);
  } catch (error) {
    setStatus("failed", "创建失败", error.message);
    updateRunCard({
      status: "failed",
      title: "创建失败",
      summary: error.message,
    });
    sendButton.disabled = false;
  }
}

function subscribeToTask(taskId) {
  eventSource?.close();
  eventSource = new EventSource(`/api/tasks/${taskId}/events`);

  eventSource.addEventListener("task-event", async (message) => {
    const event = JSON.parse(message.data);
    events.push(event);
    renderTimeline();
    setStatus(event.status, event.title, event.message);
    updateRunCard({
      status: event.status,
      title: event.title ?? statusTitle(event.status),
      summary: event.message ?? renderAssistantProgress(event),
      events,
    });

    if (event.status === "completed" || event.status === "failed") {
      eventSource.close();
      sendButton.disabled = false;
      await loadReport(taskId);
      await loadFiles(taskId);
      await loadTasks({ keepSelection: true });

      if (event.status === "completed") {
        updateRunCard({
          status: "completed",
          title: "任务完成",
          summary: "已生成产物。你可以在当前对话卡片或右侧详情中查看报告和文件。",
          events,
          showArtifacts: true,
        });
      }
    }
  });

  eventSource.onerror = () => {
    setStatus("idle", "事件流中断", "请刷新页面或重新发送消息");
    updateRunCard({
      status: "failed",
      title: "事件流中断",
      summary: "可以刷新产物，或重新发送消息。",
      events,
    });
    sendButton.disabled = false;
  };
}

async function loadTasks({ keepSelection = false } = {}) {
  const response = await fetch("/api/tasks");
  const payload = await readPayload(response);
  tasks = response.ok ? payload.tasks : [];
  renderTaskList();

  if (!keepSelection && tasks.length > 0) {
    selectTask(tasks[0].id);
  }
}

async function selectTask(taskId) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return;
  }

  eventSource?.close();
  activeTaskId = task.id;
  events = task.events ?? [];
  refreshReport.disabled = false;
  resetMessages();
  appendMessage("user", task.prompt);
  activeRunCard = appendRunMessage({
    status: task.status,
    title: statusTitle(task.status),
    summary: taskSummary(task),
    events,
    showArtifacts: task.status === "completed",
  });
  renderTaskList();
  renderTimeline();
  setStatus(task.status, statusTitle(task.status), workspaceHint(task.workspace));
  await loadReport(task.id);
  await loadFiles(task.id);
}

async function loadReport(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/report`);
  const payload = await readPayload(response);
  report.textContent = response.ok ? payload.report : payload.error ?? "产物暂不可用";
}

async function loadFiles(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/files`);
  const payload = await readPayload(response);

  if (!response.ok) {
    fileList.innerHTML = `<p class="muted">${escapeHtml(payload.error ?? "文件列表加载失败")}</p>`;
    fileCount.textContent = "0";
    return;
  }

  renderFiles(payload.files);
}

async function openFile(path) {
  if (!activeTaskId) {
    return;
  }

  const response = await fetch(`/api/tasks/${activeTaskId}/files/content?path=${encodeURIComponent(path)}`);
  const payload = await readPayload(response);
  report.textContent = response.ok ? payload.content : payload.error;
}

function appendMessage(role, text) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `
    <div class="avatar">${role === "user" ? "你" : "A"}</div>
    <div class="bubble"><p>${escapeHtml(text)}</p></div>
  `;
  messageList.append(article);
  messageList.scrollTop = messageList.scrollHeight;
  return article.querySelector(".bubble p");
}

function appendRunMessage({ status, title, summary, events: runEvents = [], showArtifacts = false }) {
  const article = document.createElement("article");
  article.className = "message assistant";
  article.innerHTML = `
    <div class="avatar">A</div>
    <div class="bubble run-bubble">
      <section class="run-card ${runStatusClass(status)}">
        <header class="run-card-header">
          <span class="run-state">${escapeHtml(statusTitle(status))}</span>
          <div>
            <strong data-run-title>${escapeHtml(title)}</strong>
            <p data-run-summary>${escapeHtml(summary)}</p>
          </div>
        </header>
        <ol class="run-steps" data-run-steps></ol>
        <div class="run-artifacts" data-run-artifacts hidden>
          <button class="secondary" type="button" data-action="show-report">查看报告</button>
          <button class="secondary" type="button" data-action="show-files">查看文件</button>
        </div>
      </section>
    </div>
  `;

  messageList.append(article);
  const card = article.querySelector(".run-card");
  card.querySelector('[data-action="show-report"]').addEventListener("click", () => {
    report.scrollIntoView({ block: "nearest" });
    if (activeTaskId) {
      loadReport(activeTaskId);
    }
  });
  card.querySelector('[data-action="show-files"]').addEventListener("click", () => {
    fileList.scrollIntoView({ block: "nearest" });
    if (activeTaskId) {
      loadFiles(activeTaskId);
    }
  });

  activeRunCard = card;
  updateRunCard({ status, title, summary, events: runEvents, showArtifacts });
  messageList.scrollTop = messageList.scrollHeight;
  return card;
}

function updateRunCard({ status, title, summary, events: runEvents = events, showArtifacts = false }) {
  if (!activeRunCard) {
    appendRunMessage({ status, title, summary, events: runEvents, showArtifacts });
    return;
  }

  activeRunCard.className = `run-card ${runStatusClass(status)}`;
  activeRunCard.querySelector(".run-state").textContent = statusTitle(status);
  activeRunCard.querySelector("[data-run-title]").textContent = title;
  activeRunCard.querySelector("[data-run-summary]").textContent = summary;
  activeRunCard.querySelector("[data-run-steps]").innerHTML = renderRunSteps(runEvents);
  activeRunCard.querySelector("[data-run-artifacts]").hidden = !showArtifacts;
  messageList.scrollTop = messageList.scrollHeight;
}

function resetMessages() {
  activeRunCard = null;
  messageList.innerHTML = `
    <article class="message assistant">
      <div class="avatar">A</div>
      <div class="bubble">
        <p>你好，我是 AgentDesk 智能体工作台。你可以直接描述业务目标、要生成的材料、要调研的问题，或希望我在工作区完成的任务。</p>
      </div>
    </article>
  `;
}

function resetInspector() {
  events = [];
  timeline.innerHTML = `<li class="empty">发送消息后会显示执行步骤</li>`;
  eventCount.textContent = "0";
  report.textContent = "暂无产物。";
  fileList.innerHTML = `<p class="muted">暂无文件。</p>`;
  fileCount.textContent = "0";
}

function renderTimeline() {
  eventCount.textContent = String(events.length);

  if (events.length === 0) {
    timeline.innerHTML = `<li class="empty">暂无执行事件</li>`;
    return;
  }

  timeline.innerHTML = events
    .map(
      (event) => `
        <li>
          <strong>${escapeHtml(event.title ?? event.type)}</strong>
          <span>${escapeHtml(event.message ?? "")}</span>
          <small>${new Date(event.timestamp).toLocaleTimeString()}</small>
        </li>
      `,
    )
    .join("");
}

function renderFiles(files) {
  fileCount.textContent = String(files.length);

  if (files.length === 0) {
    fileList.innerHTML = `<p class="muted">暂无工作区文件。</p>`;
    return;
  }

  fileList.innerHTML = files
    .map(
      (file) => `
        <button class="file-item" type="button" data-path="${escapeHtml(file.path)}">
          <strong>${escapeHtml(file.path)}</strong>
          <small>${escapeHtml(file.kind)} · ${formatBytes(file.size)}</small>
        </button>
      `,
    )
    .join("");

  for (const item of fileList.querySelectorAll(".file-item")) {
    item.addEventListener("click", () => openFile(item.dataset.path));
  }
}

function renderTaskList() {
  if (tasks.length === 0) {
    taskList.innerHTML = `<p class="muted">暂无对话</p>`;
    return;
  }

  taskList.innerHTML = tasks
    .map(
      (task) => `
        <button class="conversation ${task.id === activeTaskId ? "active" : ""}" type="button" data-task-id="${escapeHtml(task.id)}">
          <span>${escapeHtml(task.prompt)}</span>
          <small>${escapeHtml(statusTitle(task.status))}</small>
        </button>
      `,
    )
    .join("");

  for (const item of taskList.querySelectorAll(".conversation")) {
    item.addEventListener("click", () => selectTask(item.dataset.taskId));
  }
}

function renderAssistantProgress(event) {
  if (event.status === "failed") {
    return `任务失败：${event.message ?? event.title}`;
  }

  return `${event.title ?? "正在执行"}：${event.message ?? "处理中"}`;
}

function renderRunSteps(runEvents) {
  if (!runEvents || runEvents.length === 0) {
    return `<li class="run-step empty">等待第一个执行事件</li>`;
  }

  return runEvents
    .map(
      (event) => `
        <li class="run-step ${runStatusClass(event.status)}">
          <span class="run-step-dot"></span>
          <div>
            <strong>${escapeHtml(event.title ?? event.type)}</strong>
            <p>${escapeHtml(event.message ?? "")}</p>
            <small>${new Date(event.timestamp).toLocaleTimeString()}</small>
          </div>
        </li>
      `,
    )
    .join("");
}

function runStatusClass(status) {
  if (status === "completed") {
    return "is-completed";
  }

  if (status === "failed") {
    return "is-failed";
  }

  if (status === "running") {
    return "is-running";
  }

  return "is-idle";
}

function taskSummary(task) {
  if (task.status === "completed") {
    return "这次任务已完成。右侧可以查看历史产物和工作区文件。";
  }

  if (task.status === "failed") {
    return "这次任务失败了。右侧执行轨迹里保留了失败信息。";
  }

  return "这是一个历史任务，右侧可以查看已记录的执行轨迹。";
}

function statusTitle(status) {
  const titles = {
    completed: "已完成",
    failed: "失败",
    running: "运行中",
    idle: "待命",
  };
  return titles[status] ?? status ?? "未知";
}

async function readPayload(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return { error: await response.text() };
}

function workspaceHint(workspace) {
  if (!workspace) {
    return "历史任务";
  }

  if (typeof workspace === "string") {
    return workspace;
  }

  return workspace.title ?? workspace.path ?? workspace.id ?? "历史任务";
}

function setStatus(status, title, hint) {
  statusDot.className = `dot ${status === "completed" ? "completed" : status === "running" ? "running" : status === "failed" ? "failed" : "idle"}`;
  statusText.textContent = title;
  statusHint.textContent = hint;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}
