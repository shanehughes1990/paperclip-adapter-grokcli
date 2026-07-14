import { asNumber, asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

// Explicit automation wakes that should start a fresh Grok session.
// Do NOT include issue_continuation_needed — that wake should resume where the
// prior run left off (e.g. after max_turns or a corrective continuation).
const SKIP_RESUME_WAKE_REASON_RE =
  /^(?:run_liveness_continuation|finish_successful_run_handoff|issue_status_changed|issue_assignment_recovery|issue_recovery_.*|issue_.*recovery.*)$/i;

const SKIP_RESUME_WAKE_FRAGMENT_RE =
  /handoff|followup|follow-up|needs_followup|status_changed|status_change|recovery/i;

function wakeReasonFromContext(context: Record<string, unknown>): string {
  const direct = asString(context.wakeReason, "").trim();
  if (direct) return direct;

  const paperclipWake = parseObject(context.paperclipWake);
  const fromWake = asString(paperclipWake.reason, "").trim();
  if (fromWake) return fromWake;

  return "";
}

export function shouldSkipGrokSessionResume(
  context: Record<string, unknown>,
  wakeReason: string | null,
): boolean {
  const resolvedWakeReason = (wakeReason ?? "").trim() || wakeReasonFromContext(context);
  if (resolvedWakeReason) {
    if (SKIP_RESUME_WAKE_REASON_RE.test(resolvedWakeReason)) return true;
    if (SKIP_RESUME_WAKE_FRAGMENT_RE.test(resolvedWakeReason)) return true;
  }

  if (asNumber(context.livenessContinuationAttempt, 0) > 0) return true;

  const handoffReason = asString(context.handoffReason, "").trim();
  if (handoffReason) return true;

  if (context.handoffRequired === true) return true;

  const recoveryIntent = asString(context.recoveryIntent, "").trim();
  if (recoveryIntent) return true;

  const livenessState = asString(context.livenessState, "").trim();
  if (/needs_followup|recovery/i.test(livenessState)) return true;

  return false;
}