import { spawn } from "node:child_process";

export function runCommand({ bin, args, cwd, env = process.env, timeoutMs = 120_000 }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        stdout,
        stderr: stderr
          ? `${stderr}\nCommand timed out after ${timeoutMs}ms`
          : `Command timed out after ${timeoutMs}ms`,
        code: 124,
      });
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr ? `${stderr}\n${error.message}` : error.message,
        code: 1,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        code: code ?? 0,
      });
    });
  });
}
