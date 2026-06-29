import { writeWorkspaceFile } from "../../agent-workspace/src/workspace.js";

export class MockOpenCodeRunner {
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
      title: "任务已启动",
      message: `开始执行：${prompt}`,
    });

    await emit({
      type: "plan",
      status: "running",
      title: "调研计划",
      message: "拆解主题、收集公开资料、保存证据、撰写报告。",
    });

    await writeWorkspaceFile(
      workspace,
      "sources/mock-source.md",
      `# 模拟来源\n\n主题：${prompt}\n\n这是 MVP 阶段用于验证流程的模拟来源。`,
    );

    await emit({
      type: "tool",
      status: "running",
      title: "保存来源",
      message: "已将模拟来源保存到 sources/mock-source.md。",
    });

    await writeWorkspaceFile(
      workspace,
      "notes/research-notes.md",
      `# 中间笔记\n\n- 任务主题：${prompt}\n- 当前使用 mock runner 验证业务工作区和事件流。`,
    );

    await emit({
      type: "artifact",
      status: "running",
      title: "生成笔记",
      message: "已生成 notes/research-notes.md。",
      artifactPath: "notes/research-notes.md",
    });

    const report = [
      `# ${prompt}`,
      "",
      "## 摘要",
      "",
      "这是由 MVP mock runner 生成的调研报告，用于验证 AgentDesk 智能体工作台的端到端流程。",
      "",
      "## 初步发现",
      "",
      "- 平台已经能创建标准任务工作区。",
      "- 平台已经能记录事件流并生成可预览报告。",
      "- 后续可以将 mock runner 替换为真实 OpenCode serve + SDK。",
      "",
      "## 来源",
      "",
      "- `sources/mock-source.md`",
      "",
    ].join("\n");

    await writeWorkspaceFile(workspace, "output/report.md", report);

    await emit({
      type: "artifact",
      status: "running",
      title: "生成报告",
      message: "已生成 output/report.md。",
      artifactPath: "output/report.md",
    });

    await emit({
      type: "completed",
      status: "completed",
      title: "任务完成",
      message: "深度调研任务已完成。",
      artifactPath: "output/report.md",
    });
  }
}
