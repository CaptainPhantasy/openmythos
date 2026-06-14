import assert from "node:assert/strict";
import test from "node:test";
import { renderDashboard } from "../ui/tui.js";

test("renderDashboard displays run and recent event state", () => {
  const output = renderDashboard({
    runs: [{
      runId: "run-1",
      goal: "test goal",
      status: "completed",
      currentPhase: "complete",
      phasesCompleted: ["intake", "context", "plan", "execute", "verify", "complete"],
      retryCount: 0,
      maxRetries: 1,
      startedAt: "2026-06-14T00:00:00.000Z",
      completedAt: "2026-06-14T00:00:01.000Z",
      finalOutput: "done",
      error: null
    }],
    selectedRun: {
      runId: "run-1",
      goal: "test goal",
      status: "completed",
      currentPhase: "complete",
      phasesCompleted: ["intake", "context", "plan", "execute", "verify", "complete"],
      retryCount: 0,
      maxRetries: 1,
      startedAt: "2026-06-14T00:00:00.000Z",
      completedAt: "2026-06-14T00:00:01.000Z",
      finalOutput: "done",
      error: null
    },
    metrics: [{
      runId: "run-1",
      goal: "test goal",
      status: "completed",
      startedAt: "2026-06-14T00:00:00.000Z",
      completedAt: "2026-06-14T00:00:01.000Z",
      totalDurationMs: 1000,
      retryCount: 0,
      phaseCount: 6,
      contextFileCount: 2,
      taskCount: 1,
      modelTaskCount: 1,
      harnessTaskCount: 0,
      fileEditCount: 1,
      patchEditCount: 0,
      deleteEditCount: 0,
      highRiskReviewCount: 0,
      blockingReviewCount: 0,
      localVerificationCount: 1,
      localVerificationFailureCount: 0,
      taskVerificationCount: 2,
      taskVerificationFailureCount: 0,
      qaPassed: true,
      qaScore: 100,
      modelUsage: [{
        role: "planner",
        model: "glm-5.1",
        calls: 1,
        inputTokens: 10,
        outputTokens: 20,
        durationMs: 30
      }]
    }],
    selectedMetrics: {
      runId: "run-1",
      goal: "test goal",
      status: "completed",
      startedAt: "2026-06-14T00:00:00.000Z",
      completedAt: "2026-06-14T00:00:01.000Z",
      totalDurationMs: 1000,
      retryCount: 0,
      phaseCount: 6,
      contextFileCount: 2,
      taskCount: 1,
      modelTaskCount: 1,
      harnessTaskCount: 0,
      fileEditCount: 1,
      patchEditCount: 0,
      deleteEditCount: 0,
      highRiskReviewCount: 0,
      blockingReviewCount: 0,
      localVerificationCount: 1,
      localVerificationFailureCount: 0,
      taskVerificationCount: 2,
      taskVerificationFailureCount: 0,
      qaPassed: true,
      qaScore: 100,
      modelUsage: [{
        role: "planner",
        model: "glm-5.1",
        calls: 1,
        inputTokens: 10,
        outputTokens: 20,
        durationMs: 30
      }]
    },
    artifacts: ["metrics.json", "qa.json", "review-task-1.patch"],
    events: [{
      timestamp: "2026-06-14T00:00:00.500Z",
      phase: "verify",
      action: "verify",
      status: "success",
      summary: "QA passed=true score=100",
      artifacts: ["qa.json"],
      nextActions: [],
      durationMs: 1
    }]
  });

  assert.match(output, /OpenMythos TUI/);
  assert.match(output, /Bench Summary/);
  assert.match(output, /run-1 completed/);
  assert.match(output, /task_routes: model=1 harness=0/);
  assert.match(output, /model usage:/);
  assert.match(output, /metrics\.json/);
  assert.match(output, /QA passed=true/);
});
