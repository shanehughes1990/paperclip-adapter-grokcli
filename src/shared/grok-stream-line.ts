import type { TranscriptEntry } from "@paperclipai/adapter-utils";
import { applyTurnBoundary, type TurnBoundaryState } from "./turn-boundary.js";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function extractErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return "";
  return asString(record.message) || asString(record.detail) || asString(record.code);
}

function stringifyUnknown(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pickToolUseId(parsed: Record<string, unknown>): string {
  return (
    asString(parsed.toolCallId) ||
    asString(parsed.tool_call_id) ||
    asString(parsed.toolUseId) ||
    asString(parsed.id) ||
    ""
  );
}

function pickToolName(parsed: Record<string, unknown>, fallback = "tool"): string {
  return (
    asString(parsed.name) ||
    asString(parsed.toolName) ||
    asString(parsed.tool) ||
    fallback
  );
}

function parseToolCallEvent(parsed: Record<string, unknown>, ts: string): TranscriptEntry[] {
  const toolUseId = pickToolUseId(parsed);
  const name = pickToolName(parsed);
  const input =
    parsed.input !== undefined
      ? parsed.input
      : parsed.arguments !== undefined
        ? parsed.arguments
        : parsed.args !== undefined
          ? parsed.args
          : {};
  return [
    {
      kind: "tool_call",
      ts,
      name,
      ...(toolUseId ? { toolUseId } : {}),
      input,
    },
  ];
}

function parseToolResultEvent(parsed: Record<string, unknown>, ts: string): TranscriptEntry[] {
  const toolUseId = pickToolUseId(parsed) || pickToolName(parsed, "tool");
  const toolName = pickToolName(parsed, "");
  const content =
    asString(parsed.data) ||
    asString(parsed.output) ||
    asString(parsed.result) ||
    stringifyUnknown(parsed.content ?? parsed.rawOutput);
  const isError =
    parsed.isError === true ||
    parsed.is_error === true ||
    asString(parsed.status).toLowerCase() === "failed" ||
    asString(parsed.status).toLowerCase() === "error";
  return [
    {
      kind: "tool_result",
      ts,
      toolUseId,
      ...(toolName ? { toolName } : {}),
      content: content || asString(parsed.status) || "tool completed",
      isError,
    },
  ];
}

/** Map one Grok `streaming-json` stdout line to Paperclip transcript entries. */
export function parseGrokStreamingJsonLine(
  line: string,
  ts: string,
  thoughtBoundary: TurnBoundaryState,
): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const parsed = asRecord(safeJsonParse(trimmed));
  if (!parsed) {
    if (trimmed.startsWith("[paperclip]") || trimmed.startsWith("[grokcli]")) {
      return [{ kind: "system", ts, text: trimmed }];
    }
    if (trimmed.toLowerCase().includes("error")) {
      return [{ kind: "stderr", ts, text: trimmed }];
    }
    return [{ kind: "stdout", ts, text: trimmed }];
  }

  const type = asString(parsed.type).trim();

  if (type === "thought") {
    const text = asString(parsed.data);
    if (!text) return [];
    return [{ kind: "thinking", ts, text: applyTurnBoundary(thoughtBoundary, text), delta: true }];
  }

  if (type === "text") {
    const text = asString(parsed.data);
    if (!text) return [];
    return [{ kind: "assistant", ts, text, delta: true }];
  }

  if (type === "error") {
    const text = asString(parsed.data) || asString(parsed.message) || extractErrorText(parsed.error);
    return text ? [{ kind: "stderr", ts, text }] : [{ kind: "stderr", ts, text: "Grok error" }];
  }

  if (type === "end") {
    const stopReason = asString(parsed.stopReason).trim();
    const sessionId = asString(parsed.sessionId).trim();
    const parts = [
      stopReason ? `stop_reason=${stopReason}` : "",
      sessionId ? `session=${sessionId}` : "",
    ].filter(Boolean);
    return [{ kind: "system", ts, text: parts.join(" ") || "run completed" }];
  }

  if (type === "max_turns_reached") {
    return [{ kind: "system", ts, text: "max_turns_reached" }];
  }

  if (type === "tool_call" || type === "tool_use") {
    return parseToolCallEvent(parsed, ts);
  }

  if (type === "tool_result" || type === "tool_output") {
    return parseToolResultEvent(parsed, ts);
  }

  if (type === "content_block_start" || type === "content_block_delta" || type === "content_block_stop") {
    const block = asRecord(parsed.content_block) ?? parsed;
    const blockType = asString(block.type);
    if (blockType === "tool_use" || blockType === "tool_call") {
      return parseToolCallEvent({ ...block, ...parsed }, ts);
    }
    return [];
  }

  return [{ kind: "system", ts, text: `event: ${type || "unknown"}` }];
}