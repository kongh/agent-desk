import { MockOpenCodeRunner } from "./mock-runner.js";
import { OpenCodeServeRunner } from "./opencode-serve-runner.js";
import { OpenCodeSdkRunner } from "./opencode-sdk-runner.js";

export function createAgentRunner(mode = process.env.AGENT_RUNNER ?? "mock") {
  if (mode === "opencode") {
    return new OpenCodeServeRunner();
  }

  if (mode === "opencode-sdk") {
    return new OpenCodeSdkRunner();
  }

  if (mode === "mock") {
    return new MockOpenCodeRunner();
  }

  throw new Error(`Unsupported AGENT_RUNNER: ${mode}`);
}
