import { describe, expect, it } from "vitest";
import { parseGrokStreamingJsonLine } from "./grok-stream-line.js";
import { createTurnBoundaryState } from "./turn-boundary.js";

describe("parseGrokStreamingJsonLine", () => {
  const ts = "2026-05-15T00:00:00.000Z";

  it("maps tool_call and tool_result to structured transcript entries", () => {
    const boundary = createTurnBoundaryState();
    expect(
      parseGrokStreamingJsonLine(
        JSON.stringify({
          type: "tool_call",
          toolCallId: "tc-1",
          name: "Bash",
          input: { command: "ls" },
        }),
        ts,
        boundary,
      ),
    ).toEqual([
      { kind: "tool_call", ts, name: "Bash", toolUseId: "tc-1", input: { command: "ls" } },
    ]);

    expect(
      parseGrokStreamingJsonLine(
        JSON.stringify({
          type: "tool_result",
          toolCallId: "tc-1",
          name: "Bash",
          output: "file.txt\n",
        }),
        ts,
        boundary,
      ),
    ).toEqual([
      {
        kind: "tool_result",
        ts,
        toolUseId: "tc-1",
        toolName: "Bash",
        content: "file.txt\n",
        isError: false,
      },
    ]);
  });
});