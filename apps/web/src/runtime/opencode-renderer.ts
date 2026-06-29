import type { TaskEvent } from "../types";

export type OpenCodeRenderModel =
  | {
      kind: "prompt_result";
      rawType: string;
      text: string;
      reasoning: string[];
      steps: PromptResultStep[];
      meta?: PromptResultMeta;
      raw: unknown;
    }
  | {
      kind: "text_delta";
      rawType: string;
      text: string;
      raw: unknown;
    }
  | {
      kind: "tool";
      rawType: string;
      tool: string;
      status?: string;
      input?: unknown;
      output?: unknown;
      raw: unknown;
    }
  | {
      kind: "file";
      rawType: string;
      file: string;
      raw: unknown;
    }
  | {
      kind: "permission";
      rawType: string;
      title: string;
      raw: unknown;
    }
  | {
      kind: "session_status";
      rawType: string;
      label: string;
      raw: unknown;
    }
  | {
      kind: "error";
      rawType: string;
      message: string;
      raw: unknown;
    }
  | {
      kind: "raw";
      rawType: string;
      raw: unknown;
    };

export function describeOpenCodeEvent(event: TaskEvent): OpenCodeRenderModel {
  const raw = event.raw;
  const payload = getPayload(raw);
  const rawType = event.rawType ?? payload?.type ?? event.type;

  if (rawType === "sdk.session.prompt.result") {
    const result = parsePromptResult(raw);
    if (result) {
      return {
        kind: "prompt_result",
        rawType,
        ...result,
        raw,
      };
    }
  }

  if (payload?.type === "message.part.updated") {
    const delta = payload.properties?.delta;
    if (typeof delta === "string" && delta.length > 0) {
      return {
        kind: "text_delta",
        rawType,
        text: delta,
        raw,
      };
    }

    const part = payload.properties?.part;
    if (part?.type === "tool") {
      return {
        kind: "tool",
        rawType,
        tool: String(part.tool ?? "tool"),
        status: stringOrUndefined(part.state?.status),
        input: part.state?.input,
        output: part.state?.output,
        raw,
      };
    }
  }

  if (payload?.type === "file.edited") {
    return {
      kind: "file",
      rawType,
      file: String(payload.properties?.file ?? "unknown"),
      raw,
    };
  }

  if (payload?.type === "permission.updated") {
    return {
      kind: "permission",
      rawType,
      title: String(payload.properties?.title ?? "Permission updated"),
      raw,
    };
  }

  if (payload?.type === "session.status" || payload?.type === "session.idle") {
    const status = payload.properties?.status;
    return {
      kind: "session_status",
      rawType,
      label: typeof status === "string" ? status : payload.type,
      raw,
    };
  }

  if (payload?.type === "session.error" || rawType === "sdk.session.prompt.error") {
    return {
      kind: "error",
      rawType,
      message: formatError(raw),
      raw,
    };
  }

  return {
    kind: "raw",
    rawType,
    raw,
  };
}

function formatError(raw: unknown) {
  if (!isRecord(raw)) {
    return "OpenCode error";
  }

  const data = raw.data;
  if (isRecord(data?.info?.error)) {
    return String(data.info.error.data?.message ?? data.info.error.message ?? data.info.error.name ?? "OpenCode error");
  }

  const payload = getPayload(raw);
  const error = payload?.properties?.error;
  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error)) {
    return String(error.message ?? error.name ?? "OpenCode error");
  }

  return "OpenCode error";
}

function parsePromptResult(raw: unknown) {
  if (!isRecord(raw) || !isRecord(raw.data)) {
    return null;
  }

  const parts = Array.isArray(raw.data.parts) ? raw.data.parts : [];
  const text = parts
    .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n");
  const reasoning = parts
    .filter((part) => isRecord(part) && part.type === "reasoning" && typeof part.text === "string")
    .map((part) => part.text);
  const steps = parts
    .filter((part) => isRecord(part) && (part.type === "step-start" || part.type === "step-finish"))
    .map((part) => ({
      type: String(part.type),
      reason: stringOrUndefined(part.reason),
      tokens: isRecord(part.tokens) ? part.tokens : undefined,
      cost: typeof part.cost === "number" ? part.cost : undefined,
    }));

  return {
    text,
    reasoning,
    steps,
    meta: parsePromptResultMeta(raw.data.info),
  };
}

function parsePromptResultMeta(info: unknown): PromptResultMeta | undefined {
  if (!isRecord(info)) {
    return undefined;
  }

  return {
    modelID: stringOrUndefined(info.modelID),
    providerID: stringOrUndefined(info.providerID),
    finish: stringOrUndefined(info.finish),
    cost: typeof info.cost === "number" ? info.cost : undefined,
    tokens: isRecord(info.tokens) ? info.tokens : undefined,
  };
}

function getPayload(raw: unknown): OpenCodePayload | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  if (isPayload(raw.payload)) {
    return raw.payload;
  }

  if (isPayload(raw)) {
    return raw;
  }

  return undefined;
}

function isPayload(value: unknown): value is OpenCodePayload {
  return isRecord(value) && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

type OpenCodePayload = {
  type: string;
  properties?: {
    title?: unknown;
    delta?: unknown;
    file?: unknown;
    status?: unknown;
    error?: unknown;
    part?: {
      type?: unknown;
      tool?: unknown;
      state?: {
        status?: unknown;
        input?: unknown;
        output?: unknown;
      };
    };
  };
};

export type PromptResultStep = {
  type: string;
  reason?: string;
  tokens?: Record<string, any>;
  cost?: number;
};

export type PromptResultMeta = {
  modelID?: string;
  providerID?: string;
  finish?: string;
  cost?: number;
  tokens?: Record<string, any>;
};
