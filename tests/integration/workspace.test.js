import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createTaskWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../../packages/agent-workspace/src/workspace.js";

test("createTaskWorkspace creates the standard business workspace layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-workspace-test-"));

  try {
    const workspace = await createTaskWorkspace(root, "调研 AI 搜索市场");

    assert.match(workspace.id, /^run_/);
    assert.equal(workspace.title, "调研 AI 搜索市场");
    assert.equal(workspace.dirs.input.endsWith("/input"), true);
    assert.equal(workspace.dirs.sources.endsWith("/sources"), true);
    assert.equal(workspace.dirs.notes.endsWith("/notes"), true);
    assert.equal(workspace.dirs.output.endsWith("/output"), true);
    assert.equal(workspace.dirs.logs.endsWith("/logs"), true);

    await writeWorkspaceFile(workspace, "output/report.md", "# 报告");
    const report = await readWorkspaceFile(workspace, "output/report.md");

    assert.equal(report, "# 报告");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listWorkspaceFiles returns files from the standard workspace directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-workspace-list-test-"));

  try {
    const workspace = await createTaskWorkspace(root, "列出证据链");

    await writeWorkspaceFile(workspace, "sources/source.md", "# 来源");
    await writeWorkspaceFile(workspace, "notes/analysis.md", "# 分析");
    await writeWorkspaceFile(workspace, "output/report.md", "# 报告");

    const files = await listWorkspaceFiles(workspace);

    assert.deepEqual(
      files.map((file) => file.path),
      ["sources/source.md", "notes/analysis.md", "output/report.md"],
    );
    assert.deepEqual(
      files.map((file) => file.kind),
      ["sources", "notes", "output"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
