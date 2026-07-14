#!/usr/bin/env node
/**
 * End-to-end server + parser verification for grokcli (no Electron UI).
 * Usage: node scripts/verify-paperclip-loop.mjs [--base http://127.0.0.1:3100] [--run-id UUID]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(root, "dist/ui-parser.js");

function parseArgs(argv) {
  const out = { base: "http://127.0.0.1:3100", runId: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) {
      out.base = argv[++i].replace(/\/$/, "");
    } else if (argv[i] === "--run-id" && argv[i + 1]) {
      out.runId = argv[++i];
    }
  }
  return out;
}

function appendTranscriptEntry(entries, entry) {
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

function loadUiParserBundle() {
  const source = fs.readFileSync(bundlePath, "utf8");
  const exports = {};
  const module = { exports };
  const factory = new Function(
    "exports",
    "module",
    "self",
    "globalThis",
    `"use strict";\n{\n${source}\n}`,
  );
  factory(exports, module, undefined, undefined);
  const resolved =
    module.exports && typeof module.exports === "object" && Object.keys(module.exports).length > 0
      ? module.exports
      : exports;
  return resolved;
}

function parsePaperclipLogBody(text) {
  const lines = [];
  let content = text;
  try {
    const wrapper = JSON.parse(text);
    if (wrapper && typeof wrapper.content === "string") {
      content = wrapper.content;
    }
  } catch {
    // not a JSON wrapper — treat as raw ndjson
  }
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row.stream === "stdout" || row.stream === "stderr") {
        const chunk = row.chunk ?? "";
        for (const part of chunk.split("\n")) {
          const line = part.trimEnd();
          if (line) lines.push({ ts: row.ts ?? new Date().toISOString(), stream: row.stream, text: line });
        }
      }
    } catch {
      lines.push({ ts: new Date().toISOString(), stream: "stdout", text: trimmed });
    }
  }
  return lines;
}

function buildTranscript(logLines, parser) {
  const entries = [];
  for (const row of logLines) {
    for (const entry of parser.parseLine(row.text, row.ts)) {
      appendTranscriptEntry(entries, entry);
    }
  }
  return entries;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = body;
  }
  return { ok: res.ok, status: res.status, json, body };
}

async function main() {
  const { base, runId: runIdArg } = parseArgs(process.argv);
  const failures = [];

  if (!fs.existsSync(bundlePath)) {
    console.error("FAIL: dist/ui-parser.js missing — run npm run build");
    process.exit(1);
  }

  console.log(`[1/5] POST ${base}/api/adapters/grokcli/reload`);
  const reload = await fetchJson(`${base}/api/adapters/grokcli/reload`, { method: "POST" });
  if (!reload.ok) {
    failures.push(`adapter reload HTTP ${reload.status}: ${reload.body?.slice?.(0, 200) ?? reload.body}`);
  } else {
    console.log("  OK", reload.json);
  }

  console.log(`[2/5] GET ${base}/api/adapters/grokcli/ui-parser.js`);
  const parserRes = await fetch(`${base}/api/adapters/grokcli/ui-parser.js`);
  if (!parserRes.ok) {
    failures.push(`ui-parser.js HTTP ${parserRes.status}`);
  } else {
    const ct = parserRes.headers.get("content-type") ?? "";
    if (!ct.includes("javascript")) failures.push(`ui-parser content-type unexpected: ${ct}`);
    else console.log("  OK", parserRes.status, ct);
  }

  console.log("[3/5] Worker-style init of local dist/ui-parser.js");
  const mod = loadUiParserBundle();
  if (typeof mod.createStdoutParser !== "function") {
    failures.push("bundle missing createStdoutParser");
  } else {
    const probe = mod.createStdoutParser();
    const sample = probe.parseLine('{"type":"thought","data":"x"}', "2026-01-01T00:00:00.000Z");
    if (sample.some((e) => e.kind === "stdout" && String(e.text).includes('"type":"thought"'))) {
      failures.push("probe parser still emits raw JSON as stdout");
    } else if (!sample.some((e) => e.kind === "thinking")) {
      failures.push("probe parser did not emit thinking for thought line");
    } else {
      console.log("  OK thinking entries:", sample.filter((e) => e.kind === "thinking").length);
    }
  }

  let runId = runIdArg;
  if (!runId) {
    console.log(`[4/5] Resolve latest grokcli run (agent chief-of-staff)`);
    const companyId = "d18c61ee-2c0d-4571-be72-d662312942e6";
    const agent = await fetchJson(
      `${base}/api/agents/chief-of-staff?companyId=${companyId}`,
    );
    const agentId = agent.json?.id;
    if (!agentId) {
      failures.push("could not resolve chief-of-staff agent id");
    } else {
      const runs = await fetchJson(
        `${base}/api/companies/${companyId}/heartbeat-runs?agentId=${agentId}&limit=5`,
      );
      const list = Array.isArray(runs.json) ? runs.json : runs.json?.items ?? [];
      runId = list[0]?.id ?? null;
      if (!runId) failures.push("no heartbeat runs for agent");
      else console.log("  runId", runId);
    }
  } else {
    console.log("[4/5] Using run-id", runId);
  }

  if (runId) {
    console.log(`[5/5] Parse run log ${runId}`);
    const log = await fetch(`${base}/api/heartbeat-runs/${runId}/log?offset=0&limitBytes=512000`);
    if (!log.ok) {
      failures.push(`run log HTTP ${log.status}`);
    } else {
      const logText = await log.text();
      const logLines = parsePaperclipLogBody(logText);
      const jsonLines = logLines.filter((l) => l.text.includes('"type":"thought"') || l.text.includes('"type":"text"'));
      const parser = mod.createStdoutParser();
      const transcript = buildTranscript(logLines, parser);
      const rawStdout = transcript.filter(
        (e) => e.kind === "stdout" && (e.text?.includes('"type":') ?? false),
      );
      const hasThinking = transcript.some((e) => e.kind === "thinking");
      const hasAssistant = transcript.some((e) => e.kind === "assistant");
      console.log(`  log lines: ${logLines.length}, streaming-json lines: ${jsonLines.length}`);
      console.log(`  transcript kinds: ${[...new Set(transcript.map((e) => e.kind))].join(", ")}`);
      if (jsonLines.length > 0 && rawStdout.length > 0) {
        failures.push(`${rawStdout.length} transcript stdout entries still contain raw JSON`);
      }
      if (jsonLines.length > 0 && !hasThinking && !hasAssistant) {
        failures.push("log had grok JSON but transcript has no thinking/assistant");
      }
      if (failures.length === 0) console.log("  OK parsed transcript looks like grokcli (not raw JSON stdout)");
    }
  }

  console.log("\n--- UI reminder (curl reload does NOT clear browser failedLoads) ---");
  console.log("In Paperclip Desktop: Adapters → grokcli → Reload, then reopen run in *nice* view.");

  if (failures.length) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error(" -", f);
    process.exit(1);
  }
  console.log("\nAll server/parser checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});