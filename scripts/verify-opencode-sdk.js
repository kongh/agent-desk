#!/usr/bin/env node
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";

const workspace = join(tmpdir(), "opencode-sdk-verify");
const outputPath = join(workspace, "output", "report.md");

await rm(workspace, { recursive: true, force: true });
await mkdir(join(workspace, "output"), { recursive: true });

const server = await createOpencodeServer({
  hostname: "127.0.0.1",
  port: Number(process.env.OPENCODE_SDK_VERIFY_PORT ?? 4097),
  timeout: Number(process.env.OPENCODE_SDK_VERIFY_TIMEOUT_MS ?? 10_000),
});

console.log(`server.url=${server.url}`);
console.log(`workspace=${workspace}`);

try {
  const client = createOpencodeClient({
    baseUrl: server.url,
    directory: workspace,
  });

  const sessionResponse = await client.session.create({
    body: {
      title: "SDK 工作区绑定验证",
    },
  });
  const session = sessionResponse.data ?? sessionResponse;
  console.log(`session.id=${session.id}`);

  await client.session.prompt({
    path: {
      id: session.id,
    },
    body: {
      parts: [
        {
          type: "text",
          text: [
            "请直接写入 output/report.md。",
            "文件内容必须是：",
            "# SDK attach 验证",
            "",
            "OK。",
            "不要反问，不要写到其他目录。",
          ].join("\n"),
        },
      ],
    },
  });

  const report = await readFile(outputPath, "utf8");
  console.log("report.path=output/report.md");
  console.log("report.content:");
  console.log(report);
} finally {
  server.close();
}
