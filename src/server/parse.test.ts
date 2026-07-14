import { describe, expect, it } from "vitest";
import {
  isGrokMaxTurns,
  isGrokUnknownSessionError,
  parseGrokJsonl,
  parseGrokStreamJson,
} from "./parse.js";

describe("parseGrokStreamJson", () => {
  it("collects streamed thought/text content and final session metadata", () => {
    const parsed = parseGrokStreamJson(
      [
        JSON.stringify({ type: "thought", data: "Plan" }),
        JSON.stringify({ type: "thought", data: " first." }),
        JSON.stringify({ type: "text", data: "hel" }),
        JSON.stringify({ type: "text", data: "lo" }),
        JSON.stringify({
          type: "end",
          stopReason: "EndTurn",
          sessionId: "sess-1",
          requestId: "req-1",
        }),
      ].join("\n"),
    );
    expect(parsed).toMatchObject({
      sessionId: "sess-1",
      summary: "hello",
      thought: "Plan first.",
      errorMessage: null,
      stopReason: "EndTurn",
      requestId: "req-1",
    });
  });

  it("reads structured error payloads", () => {
    const parsed = parseGrokStreamJson(
      [JSON.stringify({ type: "error", error: { message: "Authentication required" } })].join("\n"),
    );
    expect(parsed.errorMessage).toBe("Authentication required");
    expect(parsed.errors).toEqual(["Authentication required"]);
  });

  it("separates reasoning turns that grok streaming-json glues together", () => {
    const parsed = parseGrokStreamJson(
      [
        JSON.stringify({ type: "thought", data: "The user uses `" }),
        JSON.stringify({ type: "thought", data: "ls" }),
        JSON.stringify({ type: "thought", data: "`" }),
        JSON.stringify({ type: "thought", data: "The" }),
        JSON.stringify({ type: "thought", data: " `" }),
        JSON.stringify({ type: "thought", data: "ls" }),
        JSON.stringify({ type: "thought", data: "`" }),
        JSON.stringify({ type: "thought", data: " returned" }),
        JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-1" }),
      ].join("\n"),
    );
    expect(parsed.thought).toBe("The user uses `ls`\nThe `ls` returned");
  });

  it("aliases parseGrokJsonl to parseGrokStreamJson", () => {
    const stdout = JSON.stringify({ type: "text", data: "ok" });
    expect(parseGrokJsonl(stdout).summary).toBe("ok");
  });

  it("infers max_turns_reached when grok ends with Cancelled after max turns", () => {
    const parsed = parseGrokStreamJson(
      [
        JSON.stringify({ type: "text", data: "still working" }),
        JSON.stringify({ type: "max_turns_reached" }),
        JSON.stringify({ type: "end", stopReason: "Cancelled", sessionId: "sess-2" }),
        "max turns reached",
      ].join("\n"),
    );
    expect(parsed.stopReason).toBe("max_turns_reached");
    expect(parsed.summary).toBe("still working");
  });
});

describe("isGrokMaxTurns", () => {
  it("detects max turns from stderr when end stopReason is Cancelled", () => {
    expect(isGrokMaxTurns("Cancelled", "max turns reached\n")).toBe(true);
    expect(isGrokMaxTurns("EndTurn", "")).toBe(false);
  });
});

describe("isGrokUnknownSessionError", () => {
  it("detects stale resume failures", () => {
    expect(isGrokUnknownSessionError("", "session not found")).toBe(true);
    expect(isGrokUnknownSessionError("", "everything fine")).toBe(false);
  });
});