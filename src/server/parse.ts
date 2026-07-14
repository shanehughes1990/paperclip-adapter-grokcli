import type { UsageSummary } from "@paperclipai/adapter-utils";
import { asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { applyTurnBoundary, createTurnBoundaryState } from "../shared/turn-boundary.js";

const GROK_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|please\s+log\s+in|please\s+run\s+`?grok\s+login`?|login\s+required|requires\s+login|unauthorized|authentication\s+required|XAI_API_KEY)/i;

export interface GrokStreamParseResult {
  sessionId: string | null;
  requestId: string | null;
  stopReason: string | null;
  thought: string;
  model: string;
  costUsd: number | null;
  usage: UsageSummary | null;
  summary: string;
  resultJson: Record<string, unknown> | null;
  errors: string[];
  errorMessage: string | null;
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  const rec = parseObject(value);
  const message =
    asString(rec.message, "").trim() ||
    asString(rec.error, "").trim() ||
    asString(rec.detail, "").trim() ||
    asString(rec.code, "").trim();
  if (message) return message;
  try {
    return JSON.stringify(rec);
  } catch {
    return "";
  }
}

export function parseGrokStreamJson(stdout: string): GrokStreamParseResult {
  let sessionId: string | null = null;
  let requestId: string | null = null;
  let stopReason: string | null = null;
  let errorMessage: string | null = null;
  const textChunks: string[] = [];
  const thoughtChunks: string[] = [];
  const errors: string[] = [];
  let resultJson: Record<string, unknown> | null = null;
  const thoughtBoundary = createTurnBoundaryState();

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "").trim();
    if (type === "thought") {
      const data = asString(event.data, "");
      if (data) thoughtChunks.push(applyTurnBoundary(thoughtBoundary, data));
      continue;
    }

    if (type === "text") {
      const data = asString(event.data, "");
      if (data) textChunks.push(data);
      continue;
    }

    if (type === "error") {
      const text = errorText(event.error ?? event.message ?? event.detail ?? event.data).trim();
      if (text) {
        errors.push(text);
        errorMessage = text;
      }
      resultJson = event;
      continue;
    }

    if (type === "max_turns_reached") {
      stopReason = "max_turns_reached";
      resultJson = event;
      continue;
    }

    if (type === "end") {
      sessionId = asString(event.sessionId, sessionId ?? "").trim() || sessionId;
      const endStopReason = asString(event.stopReason, "").trim();
      if (stopReason !== "max_turns_reached") {
        stopReason = endStopReason || stopReason;
      }
      requestId = asString(event.requestId, requestId ?? "").trim() || requestId;
      resultJson = event;
      continue;
    }
  }

  if (stopReason !== "max_turns_reached" && /max turns reached/i.test(stdout)) {
    stopReason = "max_turns_reached";
  }

  return {
    sessionId,
    requestId,
    stopReason,
    thought: thoughtChunks.join("").trim(),
    model: "",
    costUsd: null,
    usage: null,
    summary: textChunks.join("").trim(),
    resultJson,
    errors,
    errorMessage,
  };
}

export function parseGrokJsonl(stdout: string): GrokStreamParseResult {
  return parseGrokStreamJson(stdout);
}

export function isGrokUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return /unknown\s+session|session(?:\s+.*)?\s+not\s+found|resume\s+.*\s+not\s+found|invalid\s+session/i.test(
    haystack,
  );
}

export function detectGrokLoginRequired(input: {
  stdout: string;
  stderr: string;
  errors: string[];
}): boolean {
  const messages = [...input.errors, input.stdout, input.stderr]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return messages.some((line) => GROK_AUTH_REQUIRED_RE.test(line));
}

export function describeGrokFailure(input: {
  exitCode: number | null;
  stderr: string;
  errors: string[];
  stopReason: string | null;
}): string | null {
  if (input.errors.length > 0) return input.errors[0] ?? null;

  const stderrLine =
    input.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";

  if (input.stopReason === "max_turns_reached") {
    return "Grok hit max_turns without completing";
  }

  if (input.stopReason === "Cancelled") {
    return "Grok run was cancelled before completing tool work";
  }

  if ((input.exitCode ?? 0) === 0) return null;

  return stderrLine
    ? `Grok exited with code ${input.exitCode ?? -1}: ${stderrLine}`
    : `Grok exited with code ${input.exitCode ?? -1}`;
}

export function isGrokMaxTurns(stopReason: string | null, stderr = ""): boolean {
  if (stopReason === "max_turns_reached") return true;
  return /max turns reached/i.test(stderr);
}