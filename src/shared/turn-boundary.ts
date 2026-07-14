export interface TurnBoundaryState {
  lastChunk: string;
  backtickParity: number;
}

export function createTurnBoundaryState(): TurnBoundaryState {
  return { lastChunk: "", backtickParity: 0 };
}

function countBackticks(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === "`") count += 1;
  }
  return count;
}

function endsWithSentenceClose(ch: string): boolean {
  return ch === "." || ch === "?" || ch === "!" || ch === ":" || ch === ";";
}

export function applyTurnBoundary(state: TurnBoundaryState, incoming: string): string {
  if (!incoming) return incoming;
  let output = incoming;
  const prev = state.lastChunk;
  if (
    prev &&
    !/\s$/.test(prev) &&
    !/^\s/.test(incoming) &&
    /^[A-Z]/.test(incoming) &&
    incoming.length >= 2
  ) {
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