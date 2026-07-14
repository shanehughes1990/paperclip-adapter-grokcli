import { describe, expect, it } from "vitest";
import { shouldSkipGrokSessionResume } from "./session-resume.js";

describe("shouldSkipGrokSessionResume", () => {
  it("skips resume for successful-run handoff wakes", () => {
    expect(
      shouldSkipGrokSessionResume(
        { wakeReason: "finish_successful_run_handoff", handoffRequired: true },
        "finish_successful_run_handoff",
      ),
    ).toBe(true);
  });

  it("skips resume for liveness continuation wakes", () => {
    expect(
      shouldSkipGrokSessionResume(
        { wakeReason: "run_liveness_continuation", livenessContinuationAttempt: 1 },
        "run_liveness_continuation",
      ),
    ).toBe(true);
  });

  it("skips resume for issue status automation wakes", () => {
    expect(
      shouldSkipGrokSessionResume(
        { wakeReason: "issue_status_changed" },
        "issue_status_changed",
      ),
    ).toBe(true);
  });

  it("allows resume for corrective issue continuation wakes", () => {
    expect(
      shouldSkipGrokSessionResume(
        { wakeReason: "issue_continuation_needed" },
        "issue_continuation_needed",
      ),
    ).toBe(false);
  });

  it("allows resume for ordinary issue wakes", () => {
    expect(
      shouldSkipGrokSessionResume({ wakeReason: "issue_assigned" }, "issue_assigned"),
    ).toBe(false);
  });
});