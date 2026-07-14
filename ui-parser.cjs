"use strict";

function createTurnBoundaryState() {
    return { lastChunk: "", backtickParity: 0 };
}
function countBackticks(text) {
    let count = 0;
    for (const ch of text) {
        if (ch === "`")
            count += 1;
    }
    return count;
}
function endsWithSentenceClose(ch) {
    return ch === "." || ch === "?" || ch === "!" || ch === ":" || ch === ";";
}
function applyTurnBoundary(state, incoming) {
    if (!incoming)
        return incoming;
    let output = incoming;
    const prev = state.lastChunk;
    if (prev &&
        !/\s$/.test(prev) &&
        !/^\s/.test(incoming) &&
        /^[A-Z]/.test(incoming) &&
        incoming.length >= 2) {
        const lastChar = prev[prev.length - 1] ?? "";
        const closingLoneBacktick = prev === "`" && state.backtickParity === 0;
        const looksLikeNewTurn = endsWithSentenceClose(lastChar) || closingLoneBacktick;
        if (looksLikeNewTurn) {
            output = `\n${incoming}`;
        }
    }
    state.lastChunk = incoming;
    state.backtickParity = (state.backtickParity + countBackticks(incoming)) % 2;
    return output;
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function asRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    return value;
}
function asString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function extractErrorText(value) {
    if (typeof value === "string")
        return value;
    const record = asRecord(value);
    if (!record)
        return "";
    return asString(record.message) || asString(record.detail) || asString(record.code);
}
function stringifyUnknown(value) {
    if (value === undefined || value === null)
        return "";
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function pickToolUseId(parsed) {
    return (asString(parsed.toolCallId) ||
        asString(parsed.tool_call_id) ||
        asString(parsed.toolUseId) ||
        asString(parsed.id) ||
        "");
}
function pickToolName(parsed, fallback = "tool") {
    return (asString(parsed.name) ||
        asString(parsed.toolName) ||
        asString(parsed.tool) ||
        fallback);
}
function parseToolCallEvent(parsed, ts) {
    const toolUseId = pickToolUseId(parsed);
    const name = pickToolName(parsed);
    const input = parsed.input !== undefined
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
function parseToolResultEvent(parsed, ts) {
    const toolUseId = pickToolUseId(parsed) || pickToolName(parsed, "tool");
    const toolName = pickToolName(parsed, "");
    const content = asString(parsed.data) ||
        asString(parsed.output) ||
        asString(parsed.result) ||
        stringifyUnknown(parsed.content ?? parsed.rawOutput);
    const isError = parsed.isError === true ||
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
function parseGrokStreamingJsonLine(line, ts, thoughtBoundary) {
    const trimmed = line.trim();
    if (!trimmed)
        return [];
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
        if (!text)
            return [];
        return [{ kind: "thinking", ts, text: applyTurnBoundary(thoughtBoundary, text), delta: true }];
    }
    if (type === "text") {
        const text = asString(parsed.data);
        if (!text)
            return [];
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

function createGrokStdoutParser() {
    let thoughtBoundary = createTurnBoundaryState();
    return {
        parseLine(line, ts) {
            return parseGrokStreamingJsonLine(line, ts, thoughtBoundary);
        },
        reset() {
            thoughtBoundary = createTurnBoundaryState();
        },
    };
}
/** Paperclip UI worker looks for this export name in ui-parser bundles. */
function createStdoutParser() {
    return createGrokStdoutParser();
}
// Stateless fallback for callers that haven't migrated to the stateful factory.
function parseGrokStdoutLine(line, ts) {
    return parseGrokStreamingJsonLine(line, ts, createTurnBoundaryState());
}
/** Alias used by the Paperclip UI worker when loading ./ui-parser bundles. */
const parseStdoutLine = parseGrokStdoutLine;

module.exports = {
  parseStdoutLine,
  createStdoutParser,
  createGrokStdoutParser,
  parseGrokStdoutLine,
};

