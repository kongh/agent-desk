import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiServer } from "../../apps/api/src/server.js";

test("api server serves built web assets from a configurable web root", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-static-web-test-"));
  const webRoot = join(root, "dist");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await writeFile(join(webRoot, "index.html"), '<div id="root"></div><script src="/assets/app.js"></script>');
  await writeFile(join(webRoot, "assets/app.js"), "window.__agentWeb = true;");

  const server = createApiServer({
    workspaceRoot: join(root, "workspaces"),
    webRoot,
    runner: { async runResearchTask() {} },
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await index.text(), '<div id="root"></div><script src="/assets/app.js"></script>');

    const script = await fetch(`${baseUrl}/assets/app.js`);
    assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(await script.text(), "window.__agentWeb = true;");
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
