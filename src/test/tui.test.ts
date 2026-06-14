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
  assert.match(output, /run-1 completed/);
  assert.match(output, /QA passed=true/);
});
