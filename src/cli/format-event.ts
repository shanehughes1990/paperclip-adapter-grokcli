import pc from "picocolors";

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function printGrokStreamEvent(raw: string, _debug?: boolean): void {
  const line = raw.trim();
  if (!line) return;

  const parsed = safeJsonParse(line);
  if (!parsed) {
    if (line.includes("[grokcli]") || line.includes("[paperclip]")) {
      console.log(pc.cyan(line));
      return;
    }
    if (line.toLowerCase().includes("error")) {
      console.log(pc.red(`❌ ${line}`));
      return;
    }
    console.log(line);
    return;
  }

  const type = typeof parsed.type === "string" ? parsed.type : "";

  if (type === "text") {
    const data = typeof parsed.data === "string" ? parsed.data : "";
    if (data) process.stdout.write(pc.green(data));
    return;
  }

  if (type === "thought") {
    const data = typeof parsed.data === "string" ? parsed.data : "";
    if (data) process.stdout.write(pc.dim(`💭 ${data}`));
    return;
  }

  if (type === "error") {
    const message =
      (typeof parsed.message === "string" && parsed.message) ||
      (typeof parsed.data === "string" && parsed.data) ||
      line;
    console.log(pc.red(`❌ ${message}`));
    return;
  }

  if (type === "end") {
    const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : "";
    const stopReason = typeof parsed.stopReason === "string" ? parsed.stopReason : "";
    const parts = [pc.blue("✅ Grok run completed")];
    if (stopReason) parts.push(pc.dim(`(${stopReason})`));
    if (sessionId) parts.push(pc.dim(`session: ${sessionId.slice(0, 8)}…`));
    console.log(parts.join(" "));
    return;
  }

  if (type === "max_turns_reached") {
    console.log(pc.yellow("⚠️ Max turns reached"));
  }
}