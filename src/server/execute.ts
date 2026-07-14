import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  overrideAdapterExecutionTargetRemoteCwd,
  prepareAdapterExecutionTargetRuntime,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetCommandForLogs,
  resolveAdapterExecutionTargetTimeoutSec,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  joinPromptSections,
  parseObject,
  readPaperclipIssueWorkModeFromContext,
  readPaperclipRuntimeSkillEntries,
  renderPaperclipWakePrompt,
  renderTemplate,
  resolvePaperclipDesiredSkillNames,
  stringifyPaperclipWakePayload,
  refreshPaperclipWorkspaceEnvForExecution,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
import {
  DEFAULT_GROK_COMMAND,
  DEFAULT_GROK_MODEL,
  DEFAULT_MAX_TURNS_PER_RUN,
} from "../shared/constants.js";
import {
  describeGrokFailure,
  detectGrokLoginRequired,
  isGrokMaxTurns,
  isGrokUnknownSessionError,
  parseGrokStreamJson,
} from "./parse.js";
import { stageGrokProjectAssets } from "./stage-assets.js";
import { shouldSkipGrokSessionResume } from "./session-resume.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function renderPaperclipEnvNote(env: Record<string, string>): string {
  const paperclipKeys = Object.keys(env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort();
  if (paperclipKeys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${paperclipKeys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
    "",
    "",
  ].join("\n");
}

function renderApiAccessNote(env: Record<string, string>): string {
  if (!hasNonEmptyEnvValue(env, "PAPERCLIP_API_URL") || !hasNonEmptyEnvValue(env, "PAPERCLIP_API_KEY")) {
    return "";
  }
  return [
    "Paperclip API access note:",
    "Use shell commands with curl to make Paperclip API requests when needed.",
    "Include X-Paperclip-Run-Id on mutating requests.",
    "",
    "",
  ].join("\n");
}

function resolveBillingType(env: Record<string, string>): "api" | "subscription" {
  return hasNonEmptyEnvValue(env, "XAI_API_KEY") ? "api" : "subscription";
}

async function writePromptFile(prompt: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-grok-prompt-"));
  const filePath = path.join(dir, "prompt.md");
  await fs.writeFile(filePath, prompt, "utf8");
  return filePath;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);
  const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const command = asString(config.command, DEFAULT_GROK_COMMAND);
  const model = asString(config.model, DEFAULT_GROK_MODEL).trim();
  const effort = asString(config.effort, "").trim();
  const maxTurns = asNumber(config.maxTurnsPerRun, DEFAULT_MAX_TURNS_PER_RUN);
  const alwaysApprove = asBoolean(config.alwaysApprove, true);
  const disableWebSearch = asBoolean(config.disableWebSearch, false);
  const noPlan = asBoolean(config.noPlan, false);
  const noSubagents = asBoolean(config.noSubagents, false);
  const disallowedTools = asStringArray(config.disallowedTools);

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter((value) => typeof value === "object" && value !== null)
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const grokSkillEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredGrokSkillNames = resolvePaperclipDesiredSkillNames(config, grokSkillEntries);
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const stagedAssets = await stageGrokProjectAssets({
    cwd,
    instructionsFilePath,
    skillEntries: grokSkillEntries,
    desiredSkillNames: desiredGrokSkillNames,
    onLog,
  });

  let restoreRemoteWorkspace: (() => Promise<void>) | null = null;
  let promptFileDir: string | null = null;

  try {
    await onLog(
      "stdout",
      "[paperclip] grokcli adapter execute (raw streaming-json run log)\n",
    );
    const envConfig = parseObject(config.env);
    const hasExplicitApiKey =
      typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
    const env = { ...buildPaperclipEnv(agent) };
    env.PAPERCLIP_RUN_ID = runId;
    env.GROK_DISABLE_AUTOUPDATER = env.GROK_DISABLE_AUTOUPDATER ?? "1";

    const wakeTaskId =
      (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
      (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
      null;
    const wakeReason =
      typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
        ? context.wakeReason.trim()
        : null;
    const wakeCommentId =
      (typeof context.wakeCommentId === "string" &&
        context.wakeCommentId.trim().length > 0 &&
        context.wakeCommentId.trim()) ||
      (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
      null;
    const approvalId =
      typeof context.approvalId === "string" && context.approvalId.trim().length > 0
        ? context.approvalId.trim()
        : null;
    const approvalStatus =
      typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
        ? context.approvalStatus.trim()
        : null;
    const linkedIssueIds = Array.isArray(context.issueIds)
      ? context.issueIds.filter((value) => typeof value === "string" && value.trim().length > 0)
      : [];
    const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);
    const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);

    if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
    if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
    if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
    if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
    if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
    if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
    if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
    if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;

    refreshPaperclipWorkspaceEnvForExecution({
      env,
      envConfig,
      workspaceCwd: effectiveWorkspaceCwd,
      workspaceSource,
      workspaceId,
      workspaceRepoUrl,
      workspaceRepoRef,
      workspaceHints,
      agentHome,
      executionTargetIsRemote,
      executionCwd: effectiveExecutionCwd,
    });

    if (!hasExplicitApiKey && authToken) {
      env.PAPERCLIP_API_KEY = authToken;
    }

    const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(
      executionTarget,
      asNumber(config.timeoutSec, 0),
    );
    const graceSec = asNumber(config.graceSec, 20);

    await ensureAdapterExecutionTargetRuntimeCommandInstalled({
      runId,
      target: executionTarget,
      installCommand: ctx.runtimeCommandSpec?.installCommand,
      detectCommand: ctx.runtimeCommandSpec?.detectCommand,
      cwd,
      env,
      timeoutSec,
      graceSec,
      onLog,
    });

    if (executionTargetIsRemote) {
      await onLog(
        "stdout",
        `[paperclip] Syncing Grok workspace to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
      );
      const preparedExecutionTargetRuntime = await prepareAdapterExecutionTargetRuntime({
        runId,
        target: executionTarget,
        adapterKey: "grok",
        workspaceLocalDir: cwd,
        timeoutSec,
        installCommand: ctx.runtimeCommandSpec?.installCommand ?? null,
        detectCommand: ctx.runtimeCommandSpec?.detectCommand ?? command,
        onProgress: (line) => onLog("stdout", line),
        onRuntimeProgress: ctx.onRuntimeProgress,
      });
      restoreRemoteWorkspace = () =>
        preparedExecutionTargetRuntime.restoreWorkspace((line) => onLog("stdout", line));
      effectiveExecutionCwd =
        preparedExecutionTargetRuntime.workspaceRemoteDir ?? effectiveExecutionCwd;
      refreshPaperclipWorkspaceEnvForExecution({
        env,
        envConfig,
        workspaceCwd: effectiveWorkspaceCwd,
        workspaceSource,
        workspaceId,
        workspaceRepoUrl,
        workspaceRepoRef,
        workspaceHints,
        agentHome,
        executionTargetIsRemote,
        executionCwd: effectiveExecutionCwd,
      });
    }

    const runtimeExecutionTarget = overrideAdapterExecutionTargetRemoteCwd(
      executionTarget,
      effectiveExecutionCwd,
    );
    const effectiveEnv = Object.fromEntries(
      Object.entries({ ...process.env, ...env }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const runtimeEnv = ensurePathInEnv(effectiveEnv);
    await ensureAdapterExecutionTargetCommandResolvable(command, executionTarget, cwd, runtimeEnv, {
      installCommand: ctx.runtimeCommandSpec?.installCommand ?? null,
      timeoutSec,
    });
    const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(
      command,
      executionTarget,
      cwd,
      runtimeEnv,
    );
    const loggedEnv = buildInvocationEnvForLogs(env, {
      runtimeEnv,
      includeRuntimeKeys: ["HOME"],
      resolvedCommand,
    });
    const billingType = resolveBillingType(effectiveEnv);

    const runtimeSessionParams = parseObject(runtime.sessionParams);
    const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
    const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
    const runtimeRemoteExecution = parseObject(runtimeSessionParams.remoteExecution);
    const canResumeSession =
      runtimeSessionId.length > 0 &&
      (runtimeSessionCwd.length === 0 ||
        path.resolve(runtimeSessionCwd) === path.resolve(effectiveExecutionCwd)) &&
      adapterExecutionTargetSessionMatches(runtimeRemoteExecution, runtimeExecutionTarget);
    const skipResumeForRecovery = shouldSkipGrokSessionResume(
      context as Record<string, unknown>,
      wakeReason,
    );
    const sessionId = canResumeSession && !skipResumeForRecovery ? runtimeSessionId : null;

    if (skipResumeForRecovery && runtimeSessionId) {
      await onLog(
        "stdout",
        `[paperclip] Skipping Grok session resume (${wakeReason ?? "recovery wake"}); starting a fresh session.\n`,
      );
    } else if (executionTargetIsRemote && runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Grok session "${runtimeSessionId}" does not match the current remote execution identity and will not be resumed in "${effectiveExecutionCwd}". Starting a fresh remote session.\n`,
      );
    } else if (runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Grok session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${effectiveExecutionCwd}".\n`,
      );
    }

    const commandNotes = (() => {
      const notes = ["Prompt is passed to Grok via --prompt-file in headless mode."];
      if (alwaysApprove) notes.push("Added --always-approve for unattended tool execution.");
      if (stagedAssets.stagedInstructionsPath) {
        notes.push(
          `Staged project instructions at ${stagedAssets.stagedInstructionsPath} for native Grok discovery.`,
        );
      }
      if (stagedAssets.rulesFilePath) {
        notes.push(`Applied fallback instructions via --rules @${stagedAssets.rulesFilePath}.`);
      }
      if (stagedAssets.stagedSkillsCount > 0) {
        notes.push(
          `Staged ${stagedAssets.stagedSkillsCount} Paperclip skill(s) into .claude/skills for native Grok discovery.`,
        );
      }
      return notes;
    })();

    const templateData = {
      agentId: agent.id,
      companyId: agent.companyId,
      runId,
      company: { id: agent.companyId },
      agent,
      run: { id: runId, source: "on_demand" },
      context,
    };
    const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake, {
      resumedSession: Boolean(sessionId),
    });
    const shouldUseResumeDeltaPrompt = Boolean(sessionId) && wakePrompt.length > 0;
    const renderedPrompt = shouldUseResumeDeltaPrompt ? "" : renderTemplate(promptTemplate, templateData);
    const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
    const paperclipEnvNote = renderPaperclipEnvNote(env);
    const apiAccessNote = renderApiAccessNote(env);
    const prompt = joinPromptSections([
      wakePrompt,
      sessionHandoffNote,
      paperclipEnvNote,
      apiAccessNote,
      renderedPrompt,
    ]);
    const promptMetrics = {
      promptChars: prompt.length,
      wakePromptChars: wakePrompt.length,
      sessionHandoffChars: sessionHandoffNote.length,
      runtimeNoteChars: paperclipEnvNote.length + apiAccessNote.length,
      heartbeatPromptChars: renderedPrompt.length,
    };

    const buildArgs = (resumeSessionId: string | null, promptFile: string) => {
      const args = [
        "--cwd",
        effectiveExecutionCwd,
        "--prompt-file",
        promptFile,
        "--output-format",
        "streaming-json",
        "--no-auto-update",
      ];
      if (resumeSessionId) args.push("--resume", resumeSessionId);
      if (model) args.push("--model", model);
      if (effort) args.push("--effort", effort);
      if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
      if (alwaysApprove) args.push("--always-approve");
      if (disableWebSearch) args.push("--disable-web-search");
      if (noPlan) args.push("--no-plan");
      if (noSubagents) args.push("--no-subagents");
      if (disallowedTools.length > 0) args.push("--disallowed-tools", disallowedTools.join(","));
      if (stagedAssets.rulesFilePath) args.push("--rules", `@${stagedAssets.rulesFilePath}`);
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();
      if (extraArgs.length > 0) args.push(...extraArgs);
      return args;
    };

    const runAttempt = async (resumeSessionId: string | null) => {
      const promptFile = await writePromptFile(prompt);
      promptFileDir = path.dirname(promptFile);
      const args = buildArgs(resumeSessionId, promptFile);
      if (onMeta) {
        await onMeta({
          adapterType: "grokcli",
          command: resolvedCommand,
          cwd: effectiveExecutionCwd,
          commandNotes,
          commandArgs: args,
          env: loggedEnv,
          prompt,
          promptMetrics,
          context,
        });
      }
      const proc = await runAdapterExecutionTargetProcess(
        runId,
        runtimeExecutionTarget,
        command,
        args,
        {
          cwd,
          env,
          timeoutSec,
          graceSec,
          onSpawn,
          onRuntimeProgress: ctx.onRuntimeProgress,
          onLog,
        },
      );
      return {
        proc,
        parsed: parseGrokStreamJson(proc.stdout),
      };
    };

    const toResult = (
      attempt: { proc: Awaited<ReturnType<typeof runAttempt>>["proc"]; parsed: ReturnType<typeof parseGrokStreamJson> },
      clearSessionOnMissingSession = false,
      isRetry = false,
    ): AdapterExecutionResult => {
      if (attempt.proc.timedOut) {
        return {
          exitCode: attempt.proc.exitCode,
          signal: attempt.proc.signal,
          timedOut: true,
          errorMessage: `Timed out after ${timeoutSec}s`,
          errorCode: "timeout",
          clearSession: clearSessionOnMissingSession,
        };
      }

      const failed = (attempt.proc.exitCode ?? 0) !== 0;
      const parsedError =
        typeof attempt.parsed.errorMessage === "string" ? attempt.parsed.errorMessage.trim() : "";
      const stderrLine = firstNonEmptyLine(attempt.proc.stderr);
      const fallbackErrorMessage =
        describeGrokFailure({
          exitCode: attempt.proc.exitCode,
          stderr: attempt.proc.stderr,
          errors: attempt.parsed.errors,
          stopReason: attempt.parsed.stopReason,
        }) ??
        parsedError ??
        stderrLine ??
        `Grok exited with code ${attempt.proc.exitCode ?? -1}`;
      const requiresLogin = detectGrokLoginRequired({
        stdout: attempt.proc.stdout,
        stderr: attempt.proc.stderr,
        errors: attempt.parsed.errors,
      });
      const canFallbackToRuntimeSession = !isRetry;
      const resolvedSessionId =
        attempt.parsed.sessionId ??
        (canFallbackToRuntimeSession ? (runtimeSessionId ?? runtime.sessionId ?? null) : null);
      const resolvedSessionParams = resolvedSessionId
        ? {
            sessionId: resolvedSessionId,
            cwd: effectiveExecutionCwd,
            ...(workspaceId ? { workspaceId } : {}),
            ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
            ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
            ...(executionTargetIsRemote
              ? {
                  remoteExecution: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
                }
              : {}),
          }
        : null;
      const maxTurnsReached = isGrokMaxTurns(attempt.parsed.stopReason, attempt.proc.stderr);
      const cancelledWithoutWork =
        attempt.parsed.stopReason === "Cancelled" && !attempt.parsed.summary.trim();
      const partialMaxTurnsSuccess =
        maxTurnsReached &&
        (attempt.parsed.summary.trim().length > 0 || attempt.parsed.thought.trim().length > 0);

      return {
        exitCode: partialMaxTurnsSuccess ? 0 : attempt.proc.exitCode,
        signal: attempt.proc.signal,
        timedOut: false,
        errorMessage:
          partialMaxTurnsSuccess ||
          (!failed && !cancelledWithoutWork && attempt.parsed.errors.length === 0)
            ? null
            : fallbackErrorMessage,
        errorCode: requiresLogin ? "grok_auth_required" : null,
        usage: attempt.parsed.usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
        },
        sessionId: resolvedSessionId,
        sessionParams: resolvedSessionParams,
        sessionDisplayId: resolvedSessionId,
        provider: "xai",
        biller: billingType === "api" ? "xai" : "grok",
        model,
        billingType,
        costUsd: attempt.parsed.costUsd,
        resultJson: {
          stopReason: attempt.parsed.stopReason,
          requestId: attempt.parsed.requestId,
          ...(failed ? { stderr: attempt.proc.stderr } : {}),
        },
        summary: attempt.parsed.summary,
        clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
      };
    };

    const initial = await runAttempt(sessionId);
    if (
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      isGrokUnknownSessionError(initial.proc.stdout, initial.proc.stderr)
    ) {
      await onLog(
        "stdout",
        `[paperclip] Grok resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
      );
      const retry = await runAttempt(null);
      return toResult(retry, true, true);
    }
    return toResult(initial);
  } finally {
    await Promise.all([
      restoreRemoteWorkspace?.(),
      stagedAssets.cleanup(),
      promptFileDir
        ? fs.rm(promptFileDir, { recursive: true, force: true }).catch(() => undefined)
        : undefined,
    ]);
  }
}