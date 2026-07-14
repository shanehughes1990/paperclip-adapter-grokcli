import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  describeAdapterExecutionTarget,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetTimeoutSec,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asNumber,
  asString,
  ensureAbsoluteDirectory,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_GROK_COMMAND,
  DEFAULT_GROK_MODEL,
  DEFAULT_MAX_TURNS_PER_RUN,
  models as fallbackModels,
} from "../shared/constants.js";
import { parseGrokStreamJson } from "./parse.js";

const GROK_AUTH_REQUIRED_RE =
  /(?:not\s+logged\s+in|login\s+required|run\s+`?grok\s+login`?|authentication\s+required|unauthorized|invalid\s+credentials)/i;

export function parseGrokModelsOutput(stdout: string): {
  authenticated: boolean;
  defaultModel: string | null;
  models: string[];
} {
  const trimmedLines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const models: string[] = [];
  let defaultModel: string | null = null;
  let authenticated = false;
  let inModelsBlock = false;

  for (const line of trimmedLines) {
    if (/logged in/i.test(line)) authenticated = true;
    const defaultMatch = /^Default model:\s*(.+)$/i.exec(line);
    if (defaultMatch?.[1]) {
      defaultModel = defaultMatch[1].trim();
      continue;
    }
    if (/^Available models:/i.test(line)) {
      inModelsBlock = true;
      continue;
    }
    if (!inModelsBlock) continue;
    const bulletMatch = /^[*-]\s*(.+?)(?:\s+\(default\))?$/i.exec(line);
    if (bulletMatch?.[1]) {
      models.push(bulletMatch[1].trim());
      continue;
    }
    if (line.length > 0) {
      models.push(line.replace(/\s+\(default\)$/i, "").trim());
    }
  }

  return {
    authenticated,
    defaultModel,
    models: Array.from(new Set(models.filter(Boolean))),
  };
}

async function discoverGrokModels(
  command = DEFAULT_GROK_COMMAND,
  ctx?: AdapterEnvironmentTestContext,
): Promise<{ id: string; label: string }[]> {
  const target = ctx
    ? readAdapterExecutionTarget({ executionTarget: ctx.executionTarget ?? null })
    : null;
  const cwd = asString(ctx?.config.cwd, process.cwd());
  const config = parseObject(ctx?.config);
  const envConfig = parseObject(config.env);
  const env: Record<string, string> = { GROK_DISABLE_AUTOUPDATER: "1" };
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(target, asNumber(config.timeoutSec, 0));

  try {
    const proc = await runAdapterExecutionTargetProcess(
      `grokcli-models-${Date.now()}`,
      target,
      command,
      ["models"],
      {
        cwd,
        env,
        timeoutSec: Math.max(1, asNumber(config.helloProbeTimeoutSec, 45)),
        graceSec: 5,
        onLog: async () => {},
      },
    );
    if ((proc.exitCode ?? 1) !== 0) return fallbackModels;
    const parsed = parseGrokModelsOutput(proc.stdout);
    if (parsed.models.length === 0) return fallbackModels;
    return parsed.models.map((id) => ({
      id,
      label: id === parsed.defaultModel ? `${id} (default)` : id,
    }));
  } catch {
    return fallbackModels;
  }
}

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function resolveGrokHome(): string {
  const fromEnv = process.env.GROK_HOME;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, ".grok");
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, DEFAULT_GROK_COMMAND);
  const target = readAdapterExecutionTarget({ executionTarget: ctx.executionTarget ?? null });
  const targetIsRemote = target?.kind === "remote";
  const cwd = asString(config.cwd, process.cwd());
  const model = asString(config.model, DEFAULT_GROK_MODEL);
  const targetLabel = targetIsRemote
    ? (ctx.environmentName ?? describeAdapterExecutionTarget(target))
    : null;
  const runId = `grokcli-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (targetLabel) {
    checks.push({
      code: "grokcli_environment_target",
      level: "info",
      message: `Probing inside environment: ${targetLabel}`,
    });
  }

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "grokcli_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "grokcli_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = { GROK_DISABLE_AUTOUPDATER: "1" };
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  const configApiKey = env.XAI_API_KEY;
  const hostApiKey = process.env.XAI_API_KEY;
  const grokHome = resolveGrokHome();
  const authFile = path.join(grokHome, "auth.json");
  let hasAuthFile = false;
  try {
    await fs.access(authFile);
    hasAuthFile = true;
  } catch {
    hasAuthFile = false;
  }

  if (configApiKey?.trim() || hostApiKey?.trim()) {
    checks.push({
      code: "grokcli_api_key_found",
      level: "info",
      message: "XAI_API_KEY is set — grok-cli will use API key authentication",
    });
  } else if (hasAuthFile) {
    checks.push({
      code: "grokcli_cached_auth_found",
      level: "info",
      message: `Cached grok-cli credentials found at ${authFile}`,
      hint: "Run `grok login` to refresh credentials if runs fail with auth errors",
    });
  } else {
    checks.push({
      code: "grokcli_auth_missing",
      level: "warn",
      message: "No grok-cli authentication found on the Paperclip host",
      hint: "Set XAI_API_KEY or run `grok login` on the execution host",
    });
  }

  const canRunProbe = checks.every((check) => check.code !== "grokcli_cwd_invalid");
  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(target, asNumber(config.timeoutSec, 0));

  if (canRunProbe) {
    const modelsProbe = await runAdapterExecutionTargetProcess(runId, target, command, ["models"], {
      cwd,
      env,
      timeoutSec: Math.max(1, asNumber(config.helloProbeTimeoutSec, 45)),
      graceSec: 5,
      onLog: async () => {},
    });
    const probeOutput = `${modelsProbe.stdout}\n${modelsProbe.stderr}`;
    const parsedModels = parseGrokModelsOutput(modelsProbe.stdout);
    const authRequired = GROK_AUTH_REQUIRED_RE.test(probeOutput);

    if (modelsProbe.timedOut) {
      checks.push({
        code: "grokcli_models_probe_timed_out",
        level: "warn",
        message: "`grok models` timed out.",
      });
    } else if ((modelsProbe.exitCode ?? 1) !== 0) {
      checks.push({
        code: authRequired ? "grokcli_auth_required" : "grokcli_models_probe_failed",
        level: authRequired ? "warn" : "error",
        message: authRequired ? "Grok CLI is not authenticated." : "`grok models` failed.",
        detail: summarizeProbeDetail(modelsProbe.stdout, modelsProbe.stderr, null) ?? undefined,
      });
    } else {
      checks.push({
        code: "grokcli_models_probe_passed",
        level: "info",
        message: parsedModels.authenticated
          ? "Grok CLI authentication is configured."
          : "`grok models` completed.",
        detail: parsedModels.defaultModel ? `Default model: ${parsedModels.defaultModel}` : undefined,
      });
      if (parsedModels.models.length > 0) {
        checks.push({
          code: "grokcli_models_discovered",
          level: "info",
          message: `Discovered ${parsedModels.models.length} Grok model(s).`,
        });
      }
      if (model) {
        checks.push({
          code: parsedModels.models.includes(model) ? "grokcli_model_configured" : "grokcli_model_not_found",
          level: parsedModels.models.includes(model) ? "info" : "warn",
          message: parsedModels.models.includes(model)
            ? `Configured model: ${model}`
            : `Configured model "${model}" not found in available models.`,
        });
      }
    }
  }

  if (canRunProbe) {
    const probePromptFile = path.join(os.tmpdir(), `grokcli-probe-${Date.now()}.txt`);
    await fs.writeFile(probePromptFile, "Respond with exactly hello.", "utf8");
    try {
      const probeArgs = [
        "--cwd",
        cwd,
        "--prompt-file",
        probePromptFile,
        "--output-format",
        "streaming-json",
        "--always-approve",
        "--no-auto-update",
        "--max-turns",
        String(DEFAULT_MAX_TURNS_PER_RUN),
        "--model",
        model,
      ];
      const helloProbe = await runAdapterExecutionTargetProcess(runId, target, command, probeArgs, {
        cwd,
        env,
        timeoutSec: Math.max(1, asNumber(config.helloProbeTimeoutSec, 60)),
        graceSec: 5,
        onLog: async () => {},
      });
      const parsed = parseGrokStreamJson(helloProbe.stdout);
      const detail = summarizeProbeDetail(
        helloProbe.stdout,
        helloProbe.stderr,
        parsed.errorMessage,
      );
      const authRequired = GROK_AUTH_REQUIRED_RE.test(`${helloProbe.stdout}\n${helloProbe.stderr}`);

      if (helloProbe.timedOut) {
        checks.push({
          code: "grokcli_hello_probe_timed_out",
          level: "warn",
          message: "Grok hello probe timed out.",
        });
      } else if ((helloProbe.exitCode ?? 1) !== 0 || parsed.stopReason === "Cancelled") {
        checks.push({
          code: authRequired ? "grokcli_hello_probe_auth_required" : "grokcli_hello_probe_failed",
          level: authRequired ? "warn" : "error",
          message: authRequired
            ? "Grok CLI could not answer the hello probe because authentication is missing."
            : "Grok hello probe failed.",
          ...(detail ? { detail } : {}),
        });
      } else if (/\bhello\b/i.test(parsed.summary)) {
        checks.push({
          code: "grokcli_hello_probe_passed",
          level: "info",
          message: "Grok hello probe succeeded.",
        });
      } else {
        checks.push({
          code: "grokcli_hello_probe_unexpected_output",
          level: "warn",
          message: "Grok hello probe succeeded but returned unexpected output.",
          ...(detail ? { detail } : {}),
        });
      }
    } finally {
      await fs.rm(probePromptFile, { force: true }).catch(() => undefined);
    }
  }

  return {
    adapterType: "grokcli",
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}

export async function listGrokModels(): Promise<{ id: string; label: string }[]> {
  return discoverGrokModels();
}

export async function refreshGrokModels(): Promise<{ id: string; label: string }[]> {
  return discoverGrokModels();
}

export async function detectModel(): Promise<{
  model: string;
  provider: string;
  source: string;
  candidates?: string[];
} | null> {
  const fromEnv = process.env.GROK_MODEL;
  if (fromEnv && fromEnv.trim().length > 0) {
    return { model: fromEnv.trim(), provider: "xai", source: "env:GROK_MODEL" };
  }

  const discovered = await discoverGrokModels();
  const defaultEntry =
    discovered.find((entry) => entry.label.includes("(default)")) ?? discovered[0] ?? null;
  if (defaultEntry) {
    return {
      model: defaultEntry.id,
      provider: "xai",
      source: "grok models",
      candidates: discovered.map((entry) => entry.id),
    };
  }

  return { model: DEFAULT_GROK_MODEL, provider: "xai", source: "default" };
}