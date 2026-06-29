import { relative } from "node:path";

export function mapOpenCodeEventToTaskEvent(globalEvent, context) {
  if (!belongsToWorkspace(globalEvent, context)) {
    return null;
  }

  const payload = globalEvent?.payload;
  if (!payload?.type) {
    return null;
  }

  if (!belongsToSession(payload, context)) {
    return null;
  }

  switch (payload.type) {
    case "session.created":
      return taskEvent({
        type: "opencode-session",
        title: "OpenCode 会话已创建",
        message: "业务任务已经绑定到 OpenCode session。",
        rawType: payload.type,
        raw: payload,
      });

    case "session.status":
      return mapSessionStatus(payload);

    case "session.idle":
      return taskEvent({
        type: "opencode-idle",
        title: "OpenCode 本轮执行结束",
        message: "OpenCode session 已进入空闲状态，正在检查输出文件。",
        rawType: payload.type,
        raw: payload,
      });

    case "session.error":
      return taskEvent({
        type: "failed",
        status: "failed",
        title: "OpenCode 执行异常",
        message: formatError(payload.properties?.error),
        rawType: payload.type,
        raw: payload,
      });

    case "message.updated":
      return taskEvent({
        type: "opencode-message",
        title: "模型回复更新",
        message: "OpenCode 正在生成或更新回复。",
        rawType: payload.type,
        raw: payload,
      });

    case "message.part.updated":
      return mapMessagePart(payload);

    case "file.edited":
      return mapFileEdited(payload, context);

    case "permission.updated":
      return taskEvent({
        type: "permission",
        title: "等待权限确认",
        message: payload.properties?.title ?? "OpenCode 请求执行需要确认的操作。",
        rawType: payload.type,
        raw: payload,
      });

    default:
      return null;
  }
}

function belongsToWorkspace(globalEvent, context) {
  return !globalEvent?.directory || globalEvent.directory === context.workspacePath;
}

function belongsToSession(payload, context) {
  const sessionId =
    payload.properties?.sessionID ??
    payload.properties?.info?.id ??
    payload.properties?.part?.sessionID ??
    payload.properties?.permission?.sessionID;

  return !sessionId || sessionId === context.sessionId;
}

function mapSessionStatus(payload) {
  const status = payload.properties?.status;

  if (status?.type === "busy") {
    return taskEvent({
      type: "opencode-status",
      title: "OpenCode 正在执行",
      message: "模型正在处理任务并调用可用工具。",
      rawType: payload.type,
      raw: payload,
    });
  }

  if (status?.type === "retry") {
    return taskEvent({
      type: "opencode-status",
      title: "OpenCode 正在重试",
      message: status.message ?? `第 ${status.attempt} 次重试。`,
      rawType: payload.type,
      raw: payload,
    });
  }

  return null;
}

function mapMessagePart(payload) {
  const part = payload.properties?.part;
  if (!part) {
    return null;
  }

  if (part.type === "tool") {
    return taskEvent({
      type: "tool",
      title: formatToolTitle(part),
      message: formatToolMessage(part),
      rawType: payload.type,
      raw: payload,
    });
  }

  if (part.type === "text" && payload.properties?.delta) {
    return taskEvent({
      type: "opencode-message",
      title: "模型正在撰写",
      message: compactText(payload.properties.delta),
      rawType: payload.type,
      raw: payload,
    });
  }

  if (part.type === "step-start") {
    return taskEvent({
      type: "opencode-step",
      title: "开始新的执行步骤",
      message: "OpenCode 进入下一步推理或工具调用。",
      rawType: payload.type,
      raw: payload,
    });
  }

  if (part.type === "step-finish") {
    return taskEvent({
      type: "opencode-step",
      title: "执行步骤完成",
      message: part.reason ? `完成原因：${part.reason}` : "OpenCode 完成一个执行步骤。",
      rawType: payload.type,
      raw: payload,
    });
  }

  return null;
}

function mapFileEdited(payload, context) {
  const file = payload.properties?.file;
  const artifactPath = file ? toWorkspaceRelativePath(file, context.workspacePath) : undefined;

  return taskEvent({
    type: "artifact",
    title: "文件已更新",
    message: artifactPath ? `OpenCode 已更新 ${artifactPath}。` : "OpenCode 已更新工作区文件。",
    artifactPath,
    rawType: payload.type,
    raw: payload,
  });
}

function taskEvent(event) {
  return {
    status: event.status ?? "running",
    ...event,
  };
}

function formatToolTitle(part) {
  if (part.state?.status === "completed") {
    return "工具调用完成";
  }

  if (part.state?.status === "error") {
    return "工具调用失败";
  }

  return "正在调用工具";
}

function formatToolMessage(part) {
  const input = part.state?.input ?? {};
  const target = input.filePath ?? input.path ?? input.url ?? input.query;
  const suffix = target ? `：${target}` : "";
  return `${part.tool}${suffix}`;
}

function formatError(error) {
  if (!error) {
    return "OpenCode 返回了未知错误。";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message ?? error.name ?? JSON.stringify(error);
}

function compactText(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) {
    return "模型正在输出内容。";
  }

  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function toWorkspaceRelativePath(file, workspacePath) {
  if (!file) {
    return undefined;
  }

  const path = relative(workspacePath, file);
  if (path.startsWith("..")) {
    return file;
  }

  return path;
}
