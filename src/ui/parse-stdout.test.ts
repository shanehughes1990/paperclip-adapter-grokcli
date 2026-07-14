import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createGrokStdoutParser, parseGrokStdoutLine } from "./parse-stdout.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "ui",
  "fixtures",
  "grok-streaming-sample.jsonl",
);

describe("parseGrokStdoutLine", () => {
  const ts = "2026-05-15T00:00:00.000Z";

  it("maps thought/text/end events into transcript entries", () => {
    expect(parseGrokStdoutLine(JSON.stringify({ type: "thought", data: "Plan first." }), ts)).toEqual([
      { kind: "thinking", ts, text: "Plan first.", delta: true },
    ]);
    expect(parseGrokStdoutLine(JSON.stringify({ type: "text", data: "hello" }), ts)).toEqual([
      { kind: "assistant", ts, text: "hello", delta: true },
    ]);
    expect(parseGrokStdoutLine(JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-1" }), ts)).toEqual([
      { kind: "system", ts, text: "stop_reason=EndTurn session=sess-1" },
    ]);
  });

  it("surfaces structured Grok error payload text", () => {
    expect(
      parseGrokStdoutLine(
        JSON.stringify({
          type: "error",
          error: { message: "Authentication required" },
        }),
        ts,
      ),
    ).toEqual([{ kind: "stderr", ts, text: "Authentication required" }]);
  });

  it("maps tool_call events to tool_call transcript entries", () => {
    expect(
      parseGrokStdoutLine(
        JSON.stringify({ type: "tool_call", toolCallId: "id-1", name: "Read", input: { path: "a.ts" } }),
        ts,
      ),
    ).toEqual([
      { kind: "tool_call", ts, name: "Read", toolUseId: "id-1", input: { path: "a.ts" } },
    ]);
  });

  it("parses a captured grok streaming-json fixture (demo output in vitest log)", () => {
    const lines = fs.readFileSync(fixturePath, "utf8").split(/\r?\n/).filter(Boolean);
    const parser = createGrokStdoutParser();
    const entries = lines.flatMap((line) => parser.parseLine(line, ts));

    const thinking = entries.filter((e) => e.kind === "thinking").map((e) => e.text).join("");
    const assistant = entries.filter((e) => e.kind === "assistant").map((e) => e.text).join("");
    const system = entries.filter((e) => e.kind === "system");

    expect(thinking.length).toBeGreaterThan(0);
    expect(assistant.toLowerCase()).toContain("ok");
    expect(system.some((e) => e.text.includes("stop_reason=") || e.text.includes("run completed"))).toBe(
      true,
    );

    console.log("\n--- grok streaming-json → TranscriptEntry (fixture) ---");
    for (const entry of entries) {
      if (entry.kind === "thinking" || entry.kind === "assistant") {
        console.log(`${entry.kind}: ${JSON.stringify(entry.text)} delta=${entry.delta ?? false}`);
      } else {
        console.log(`${entry.kind}: ${"text" in entry ? entry.text : JSON.stringify(entry)}`);
      }
    }
    console.log("--- coalesced thinking ---\n", thinking);
    console.log("--- coalesced assistant ---\n", assistant);
    console.log("--- end parse demo ---\n");
  });
});

describe("createGrokStdoutParser", () => {
  const ts = "2026-05-15T00:00:00.000Z";

  function thoughtTexts(chunks: string[]) {
    const parser = createGrokStdoutParser();
    return chunks
      .map((data) => parser.parseLine(JSON.stringify({ type: "thought", data }), ts))
      .flat()
      .map((entry) => (entry.kind === "thinking" ? entry.text : ""))
      .join("");
  }

  it("inserts a newline between reasoning turns that grok streaming-json glues together", () => {
    expect(thoughtTexts(["The user uses `", "ls", "`", "The", " `", "ls", "`", " returned"])).toBe(
      "The user uses `ls`\nThe `ls` returned",
    );
  });

  it("resets state between independent transcript builds", () => {
    const parser = createGrokStdoutParser();
    parser.parseLine(JSON.stringify({ type: "thought", data: "first:" }), ts);
    parser.reset();
    expect(parser.parseLine(JSON.stringify({ type: "thought", data: "Second" }), ts)).toEqual([
      { kind: "thinking", ts, text: "Second", delta: true },
    ]);
  });
});