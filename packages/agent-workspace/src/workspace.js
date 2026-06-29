import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, normalize, relative } from "node:path";

const STANDARD_DIRS = ["input", "sources", "notes", "output", "logs"];

export async function createTaskWorkspace(rootDir, title) {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const workspacePath = join(rootDir, id);
  const dirs = Object.fromEntries(
    STANDARD_DIRS.map((name) => [name, join(workspacePath, name)]),
  );

  await mkdir(workspacePath, { recursive: true });
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));

  return {
    id,
    title,
    path: workspacePath,
    dirs,
  };
}

export async function writeWorkspaceFile(workspace, relativePath, content) {
  const target = resolveWorkspacePath(workspace, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

export async function readWorkspaceFile(workspace, relativePath) {
  const target = resolveWorkspacePath(workspace, relativePath);
  return readFile(target, "utf8");
}

export async function listWorkspaceFiles(workspace) {
  const files = [];

  for (const kind of STANDARD_DIRS) {
    const root = workspace.dirs[kind];
    const entries = await listFiles(root);

    for (const entry of entries) {
      const relativePath = normalize(join(kind, entry));
      const target = resolveWorkspacePath(workspace, relativePath);
      const info = await stat(target);

      files.push({
        path: relativePath,
        kind,
        size: info.size,
        updatedAt: info.mtime.toISOString(),
      });
    }
  }

  return files;
}

export function resolveWorkspacePath(workspace, relativePath) {
  const normalized = normalize(relativePath);
  const target = join(workspace.path, normalized);
  const backToRoot = relative(workspace.path, target);

  if (backToRoot.startsWith("..") || backToRoot === "..") {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return target;
}

async function listFiles(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}
