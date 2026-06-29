import { readWorkspaceFile, writeWorkspaceFile } from "../../agent-workspace/src/workspace.js";
import { runCommand as defaultRunCommand } from "./command-runner.js";

export class OpenCodeServeRunner {
  constructor({
    opencodeBin = process.env.OPENCODE_BIN ?? "opencode",
    runCommand = defaultRunCommand,
    model = process.env.OPENCODE_MODEL,
    serverUrl = process.env.OPENCODE_SERVER_URL,
    timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS ?? 120_000),
  } = {}) {
    this.opencodeBin = opencodeBin;
    this.runCommand = runCommand;
    this.model = model;
    this.serverUrl = serverUrl;
    this.timeoutMs = timeoutMs;
  }

  async runResearchTask({ taskId, prompt, workspace, onEvent }) {
    const emit = async (event) => {
      await onEvent({
        taskId,
        timestamp: new Date().toISOString(),
        ...event,
      });
    };

    await emit({
      type: "started",
      status: "running",
      title: "真实 OpenCode 已启动",
      message: "正在调用 OpenCode 在业务工作区中执行深度调研任务。",
    });

    const args = ["run"];

    if (this.serverUrl) {
      args.push("--attach", this.serverUrl);
    }

    args.push("--dir", workspace.path);

    if (this.model) {
      args.push("--model", this.model);
    }

    args.push("--format", "json");
    args.push(prompt);

    await emit({
      type: "tool",
      status: "running",
      title: "调用 OpenCode",
      message: `执行 opencode run，工作区：${workspace.id}`,
    });

    const result = await this.runCommand({
      bin: this.opencodeBin,
      args,
      cwd: workspace.path,
      timeoutMs: this.timeoutMs,
    });

    if (result.code !== 0) {
      throw new Error(result.stderr || `OpenCode exited with code ${result.code}`);
    }

    for (const event of parseOpenCodeJsonOutput(result.stdout)) {
      await emit({
        type: "opencode-raw",
        status: eventStatus(event),
        title: event.type ?? "OpenCode event",
        message: formatRawMessage(event),
        rawType: event.type,
        raw: event,
      });
    }

    await ensureReportExists({ workspace, prompt, result });

    await emit({
      type: "artifact",
      status: "running",
      title: "生成报告",
      message: "OpenCode 执行完成，报告已写入 output/report.md。",
      artifactPath: "output/report.md",
    });

    await emit({
      type: "completed",
      status: "completed",
      title: "任务完成",
      message: "真实 OpenCode runner 已完成任务。",
      artifactPath: "output/report.md",
    });
  }
}

function parseOpenCodeJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const events = [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // OpenCode can emit newline-delimited JSON in streaming modes.
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const value = line.trim();
    if (!value.startsWith("{") && !value.startsWith("[")) {
      continue;
    }

    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        events.push(...parsed);
      } else {
        events.push(parsed);
      }
    } catch {
      // Ignore non-JSON log lines and keep the raw stdout available in fallback reports.
    }
  }

  return events;
}

function eventStatus(event) {
  const status = event.properties?.part?.state?.status ?? event.status;
  if (status === "error" || event.type === "session.error") {
    return "failed";
  }

  if (status === "completed" || event.type === "session.idle") {
    return "completed";
  }

  return "running";
}

function formatRawMessage(event) {
  const part = event.properties?.part;
  if (part?.type === "tool") {
    return `${part.tool ?? "tool"} ${part.state?.status ?? ""}`.trim();
  }

  if (event.properties?.delta) {
    return String(event.properties.delta);
  }

  if (event.properties?.file) {
    return String(event.properties.file);
  }

  return event.type ?? "OpenCode event";
}

async function ensureReportExists({ workspace, prompt, result }) {
  try {
    await readWorkspaceFile(workspace, "output/report.md");
  } catch {
    await writeWorkspaceFile(
      workspace,
      "output/report.md",
      [
        `# ${prompt}`,
        "",
        "## 执行结果",
        "",
        "OpenCode 已完成运行，但没有生成 `output/report.md`。系统已将 OpenCode 输出保存为兜底报告，便于继续调试 runner 接入。",
        "",
        "## OpenCode stdout",
        "",
        "```text",
        result.stdout.trim() || "(empty)",
        "```",
        "",
        "## OpenCode stderr",
        "",
        "```text",
        result.stderr.trim() || "(empty)",
        "```",
        "",
      ].join("\n"),
    );
  }
}
