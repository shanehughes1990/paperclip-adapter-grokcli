import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@paperclipai/adapter-utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundlePath = path.join(root, "dist/ui-parser.js");

function appendTranscriptEntry(entries: TranscriptEntry[], entry: TranscriptEntry) {
  if ((entry.kind === "thinking" || entry.kind === "assistant") && entry.delta) {
    const last = entries[entries.length - 1];
    if (last && last.kind === entry.kind && last.delta) {
      last.text += entry.text;
      last.ts = entry.ts;
      return;
    }
  }
  entries.push(entry);
}

function loadUiParserBundle(): {
  createStdoutParser: () => { parseLine: (line: string, ts: string) => TranscriptEntry[]; reset: () => void };
} {
  const source = fs.readFileSync(bundlePath, "utf8");
  const exports: Record<string, unknown> = {};
  const module = { exports } as { exports: Record<string, unknown> };
  const factory = new Function(
    "exports",
    "module",
    "self",
    "globalThis",
    `"use strict";\n{\n${source}\n}`,
  ) as (
    exports: Record<string, unknown>,
    module: { exports: Record<string, unknown> },
    self: undefined,
    globalThis: undefined,
  ) => void;
  factory(exports, module, undefined, undefined);
  const resolved =
    module.exports && typeof module.exports === "object" && Object.keys(module.exports).length > 0
      ? module.exports
      : exports;
  return resolved as ReturnType<typeof loadUiParserBundle>;
}

describe("dist/ui-parser.js (Paperclip worker contract)", () => {
  it("parses grok streaming-json lines without emitting raw JSON stdout", () => {
    expect(fs.existsSync(bundlePath)).toBe(true);
    const mod = loadUiParserBundle();
    const parser = mod.createStdoutParser();
    const ts = "2026-05-15T00:00:00.000Z";
    const lines = [
      '{"type":"thought","data":"Same"}',
      '{"type":"text","data":"## Heartbeat"}',
      '{"type":"end","stopReason":"EndTurn","sessionId":"sess-1"}',
    ];
    const entries: TranscriptEntry[] = [];
    for (const line of lines) {
      for (const entry of parser.parseLine(line, ts)) {
        appendTranscriptEntry(entries, entry);
      }
    }
    expect(entries.some((e) => e.kind === "stdout" && e.text?.includes('"type":"thought"'))).toBe(false);
    expect(entries.some((e) => e.kind === "thinking")).toBe(true);
    expect(entries.some((e) => e.kind === "assistant" && e.text?.includes("Heartbeat"))).toBe(true);
    expect(entries.some((e) => e.kind === "system" && e.text?.includes("stop_reason="))).toBe(true);
  });
});
