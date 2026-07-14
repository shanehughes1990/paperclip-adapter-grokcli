import type { TranscriptEntry } from "@paperclipai/adapter-utils";
import { parseGrokStreamingJsonLine } from "../shared/grok-stream-line.js";
import { createTurnBoundaryState } from "../shared/turn-boundary.js";

export function createGrokStdoutParser() {
  let thoughtBoundary = createTurnBoundaryState();
  return {
    parseLine(line: string, ts: string) {
      return parseGrokStreamingJsonLine(line, ts, thoughtBoundary);
    },
    reset() {
      thoughtBoundary = createTurnBoundaryState();
    },
  };
}

/** Paperclip UI worker looks for this export name in ui-parser bundles. */
export function createStdoutParser() {
  return createGrokStdoutParser();
}

// Stateless fallback for callers that haven't migrated to the stateful factory.
export function parseGrokStdoutLine(line: string, ts: string): TranscriptEntry[] {
  return parseGrokStreamingJsonLine(line, ts, createTurnBoundaryState());
}

/** Alias used by the Paperclip UI worker when loading ./ui-parser bundles. */
export const parseStdoutLine = parseGrokStdoutLine;