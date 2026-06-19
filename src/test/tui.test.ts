import assert from "node:assert/strict";
import test from "node:test";
import type { RunAttempt, RunEvent, RunMetrics, RunState } from "../state/types.js";
import { buildArtifactPreview, renderDashboard, sortArtifactsForDisplay, type DashboardModel } from "../ui/tui.js";

function createRun(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run-1",
    goal: "test goal",
    status: "completed",
    approved: false,
    currentPhase: "complete",
    phasesCompleted: ["intake", "context", "plan", "execute", "verify", "complete"],
    retryCount: 0,
    maxRetries: 1,
    startedAt: "2026-06-14T00:00:00.000Z",
    completedAt: "2026-06-14T00:00:01.000Z",
    finalOutput: "done",
    error: null,
    ...overrides
  };
}

function createMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
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
    modelToolTurnCount: 1,
    modelToolCallCount: 2,
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
    }],
    ...overrides
  };
}

function createAttempt(overrides: Partial<RunAttempt> = {}): RunAttempt {
  return {
    attemptId: "current",
    kind: "current",
    archivedAt: null,
    reason: null,
    state: createRun(),
    ...overrides
  };
}

function createEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    timestamp: "2026-06-14T00:00:00.500Z",
    phase: "verify",
    action: "verify",
    status: "success",
    summary: "QA passed=true score=100",
    artifacts: ["qa.json"],
    nextActions: [],
    durationMs: 1,
    ...overrides
  };
}

function createModel(overrides: Partial<DashboardModel> = {}): DashboardModel {
  const selectedRun = Object.prototype.hasOwnProperty.call(overrides, "selectedRun")
    ? overrides.selectedRun ?? null
    : createRun();
  const selectedAttempt = Object.prototype.hasOwnProperty.call(overrides, "selectedAttempt")
    ? overrides.selectedAttempt ?? null
    : (selectedRun ? createAttempt({
      attemptId: "current",
      kind: "current",
      archivedAt: null,
      reason: null,
      state: selectedRun
    }) : null);
  const attempts = overrides.attempts ?? (selectedRun && selectedAttempt ? [selectedAttempt] : []);

  return {
    runs: overrides.runs ?? (selectedRun ? [selectedRun] : []),
    selectedRun,
    attempts,
    selectedAttemptIndex: overrides.selectedAttemptIndex ?? 0,
    selectedAttempt,
    metrics: overrides.metrics ?? [createMetrics()],
    selectedMetrics: Object.prototype.hasOwnProperty.call(overrides, "selectedMetrics")
      ? overrides.selectedMetrics ?? null
      : createMetrics(),
    selectedProgress: Object.prototype.hasOwnProperty.call(overrides, "selectedProgress")
      ? overrides.selectedProgress ?? null
      : {
      completedPhaseCount: 4,
      totalPhaseCount: 6,
      plannedTaskCount: 2,
      completedTaskCount: 1,
      latestTask: {
        taskId: "task-1",
        executorKind: "model",
        executorRole: "coder",
        status: "success",
        summary: "Implemented the requested edit."
      },
      latestEvent: {
        phase: "execute",
        action: "execute_tasks",
        status: "success",
        summary: "1 task outputs applied"
      }
    },
    comparison: Object.prototype.hasOwnProperty.call(overrides, "comparison")
      ? overrides.comparison ?? null
      : null,
    artifacts: overrides.artifacts ?? ["review-task-1.patch", "qa.json", "metrics.json"],
    selectedArtifactIndex: overrides.selectedArtifactIndex ?? 0,
    selectedArtifact: Object.prototype.hasOwnProperty.call(overrides, "selectedArtifact")
      ? overrides.selectedArtifact ?? null
      : "review-task-1.patch",
    artifactComparison: Object.prototype.hasOwnProperty.call(overrides, "artifactComparison")
      ? overrides.artifactComparison ?? null
      : null,
    artifactPreview: Object.prototype.hasOwnProperty.call(overrides, "artifactPreview")
      ? overrides.artifactPreview ?? null
      : {
      artifact: "review-task-1.patch",
      lines: ["diff --git a/src/app.ts b/src/app.ts", "+const ready = true;"],
      truncated: false
    },
    events: overrides.events ?? [createEvent()]
  };
}

test("renderDashboard displays run, attempts, and recent event state", () => {
  const output = renderDashboard(createModel());

  assert.match(output, /OpenMythos TUI/);
  assert.match(output, /Bench Summary/);
  assert.match(output, /\{\/left previous attempt \| \}\/right next attempt/);
  assert.match(output, /\[ previous artifact \| \] next artifact/);
  assert.match(output, /run-1 completed/);
  assert.match(output, /Attempts/);
  assert.match(output, /> current status=completed phase=complete/);
  assert.match(output, /Selected Attempt/);
  assert.match(output, /status: completed/);
  assert.match(output, /phase: complete/);
  assert.match(output, /Attempt Comparison/);
  assert.match(output, /No comparison baseline\./);
  assert.match(output, /Artifact Comparison/);
  assert.match(output, /No artifact comparison available\./);
  assert.match(output, /task_routes: model=1 harness=0/);
  assert.match(output, /model_tool_loop: turns=1 calls=2/);
  assert.match(output, /model usage:/);
  assert.match(output, /Progress/);
  assert.match(output, /phases: 4\/6/);
  assert.match(output, /tasks: 1\/2/);
  assert.match(output, /latest task: task-1 model\/coder success/);
  assert.match(output, /Implemented the requested edit\./);
  assert.match(output, /latest event: \[success\] execute:execute_tasks/);
  assert.match(output, /Focused Artifact/);
  assert.match(output, /selected: review-task-1\.patch/);
  assert.match(output, /diff --git a\/src\/app\.ts b\/src\/app\.ts/);
  assert.match(output, /> review-task-1\.patch/);
  assert.match(output, /QA passed=true/);
});

test("renderDashboard uses live run state for bench status counts when retained metrics are stale", () => {
  const output = renderDashboard(createModel({
    runs: [
      createRun({
        runId: "run-failed",
        goal: "failed run",
        status: "failed",
        currentPhase: "execute",
        phasesCompleted: ["intake", "context", "plan"],
        completedAt: "2026-06-14T00:00:05.000Z",
        finalOutput: null,
        error: "Cancelled from TUI."
      }),
      createRun({
        runId: "run-awaiting",
        goal: "awaiting run",
        status: "awaiting_approval",
        currentPhase: "execute",
        phasesCompleted: ["intake", "context", "plan"],
        startedAt: "2026-06-14T00:01:00.000Z",
        completedAt: null,
        finalOutput: null,
        error: "Approval required."
      })
    ],
    selectedRun: null,
    attempts: [],
    selectedAttemptIndex: 0,
    selectedAttempt: null,
    metrics: [
      createMetrics({
        runId: "run-failed",
        goal: "failed run",
        status: "awaiting_approval",
        completedAt: null,
        totalDurationMs: 16,
        contextFileCount: 0,
        modelTaskCount: 0,
        modelToolTurnCount: 0,
        modelToolCallCount: 0,
        fileEditCount: 0,
        localVerificationCount: 0,
        taskCount: 1,
        qaPassed: null,
        qaScore: null,
        highRiskReviewCount: 1,
        blockingReviewCount: 1,
        taskVerificationCount: 0,
        modelUsage: []
      }),
      createMetrics({
        runId: "run-awaiting",
        goal: "awaiting run",
        status: "awaiting_approval",
        startedAt: "2026-06-14T00:01:00.000Z",
        completedAt: null,
        totalDurationMs: 18,
        contextFileCount: 0,
        modelTaskCount: 0,
        modelToolTurnCount: 0,
        modelToolCallCount: 0,
        fileEditCount: 0,
        localVerificationCount: 0,
        taskCount: 1,
        qaPassed: null,
        qaScore: null,
        highRiskReviewCount: 1,
        blockingReviewCount: 1,
        taskVerificationCount: 0,
        modelUsage: []
      })
    ],
    selectedMetrics: null,
    selectedProgress: null,
    artifacts: [],
    selectedArtifactIndex: 0,
    selectedArtifact: null,
    artifactPreview: null,
    events: []
  }));

  assert.match(output, /runs=2 completed=0 failed=1 awaiting=1 queued=0/);
});

test("renderDashboard reports queued runs distinctly from active runs", () => {
  const queuedRun = createRun({
    runId: "run-queued",
    goal: "queued run",
    status: "queued",
    currentPhase: "intake",
    phasesCompleted: [],
    completedAt: null,
    finalOutput: null
  });
  const output = renderDashboard(createModel({
    runs: [queuedRun],
    selectedRun: null,
    attempts: [],
    selectedAttemptIndex: 0,
    selectedAttempt: null,
    metrics: [],
    selectedMetrics: null,
    selectedProgress: null,
    artifacts: [],
    selectedArtifactIndex: 0,
    selectedArtifact: null,
    artifactPreview: null,
    events: []
  }));

  assert.match(output, /runs=1 completed=0 failed=0 awaiting=0 queued=1/);
  assert.match(output, /run-queued queued phase=intake/);
});

test("renderDashboard can focus an archived attempt and its artifacts", () => {
  const currentRun = createRun({
    runId: "run-1",
    status: "queued",
    currentPhase: "intake",
    phasesCompleted: [],
    completedAt: null,
    finalOutput: null
  });
  const archivedRun = createRun({
    runId: "run-1",
    status: "completed",
    currentPhase: "complete",
    phasesCompleted: ["intake", "context", "plan", "execute", "verify", "complete"]
  });
  const output = renderDashboard(createModel({
    runs: [currentRun],
    selectedRun: currentRun,
    attempts: [
      createAttempt({ attemptId: "current", kind: "current", state: currentRun }),
      createAttempt({
        attemptId: "queue-2026-06-14T00-00-01-000Z",
        kind: "history",
        archivedAt: "2026-06-14T00:00:01.500Z",
        reason: "queue",
        state: archivedRun
      })
    ],
    selectedAttemptIndex: 1,
    selectedAttempt: createAttempt({
      attemptId: "queue-2026-06-14T00-00-01-000Z",
      kind: "history",
      archivedAt: "2026-06-14T00:00:01.500Z",
      reason: "queue",
      state: archivedRun
    }),
    selectedMetrics: createMetrics(),
    selectedProgress: {
      completedPhaseCount: 6,
      totalPhaseCount: 6,
      plannedTaskCount: 1,
      completedTaskCount: 1,
      latestTask: {
        taskId: "task-archived",
        executorKind: "model",
        executorRole: "coder",
        status: "success",
        summary: "Archived attempt completed cleanly."
      },
      latestEvent: {
        phase: "verify",
        action: "verify",
        status: "success",
        summary: "Archived attempt QA passed."
      }
    },
    comparison: {
      baselineAttempt: createAttempt({ attemptId: "current", kind: "current", state: currentRun }),
      baselineRelation: "newer",
      baselineMetrics: null,
      baselineEventCount: 0,
      baselineArtifactCount: 1,
      durationDeltaMs: null,
      qaScoreDelta: null,
      fileEditDelta: null,
      patchEditDelta: null,
      taskVerificationDelta: null,
      eventCountDelta: 1,
      addedArtifacts: ["review-task-9.patch", "metrics.json"],
      removedArtifacts: ["state.json"]
    },
    artifactComparison: {
      baselineAttempt: createAttempt({ attemptId: "current", kind: "current", state: currentRun }),
      baselineRelation: "newer",
      artifact: "review-task-9.patch",
      status: "added",
      selectedLineCount: 2,
      baselineLineCount: 0,
      differingLineCount: 2,
      previewPairs: [
        { baseline: null, selected: "diff --git a/src/history.ts b/src/history.ts" },
        { baseline: null, selected: "+const archived = true;" }
      ]
    },
    artifacts: ["review-task-9.patch", "metrics.json"],
    selectedArtifactIndex: 0,
    selectedArtifact: "review-task-9.patch",
    artifactPreview: {
      artifact: "review-task-9.patch",
      lines: ["diff --git a/src/history.ts b/src/history.ts", "+const archived = true;"],
      truncated: false
    },
    events: [
      createEvent({
        timestamp: "2026-06-14T00:00:01.400Z",
        summary: "Archived attempt QA passed.",
        artifacts: ["metrics.json"]
      })
    ]
  }));

  assert.match(output, /> queue@2026-06-14T00:00:01\.500Z status=completed phase=complete/);
  assert.match(output, /id: queue-2026-06-14T00-00-01-000Z/);
  assert.match(output, /kind: history/);
  assert.match(output, /status: completed/);
  assert.match(output, /reason: queue/);
  assert.match(output, /Attempt Comparison/);
  assert.match(output, /baseline: current \(newer attempt\)/);
  assert.match(output, /baseline status: queued phase=intake/);
  assert.match(output, /duration_ms delta: unavailable/);
  assert.match(output, /events delta: \+1/);
  assert.match(output, /artifacts delta: \+2 \/ -1/);
  assert.match(output, /added vs baseline: review-task-9\.patch, metrics\.json/);
  assert.match(output, /removed vs baseline: state\.json/);
  assert.match(output, /Artifact Comparison/);
  assert.match(output, /status: added/);
  assert.match(output, /lines: selected=2 baseline=0/);
  assert.match(output, /differing lines: 2/);
  assert.match(output, /baseline: \(missing\)/);
  assert.match(output, /selected: diff --git a\/src\/history\.ts b\/src\/history\.ts/);
  assert.match(output, /Archived attempt completed cleanly\./);
  assert.match(output, /diff --git a\/src\/history\.ts b\/src\/history\.ts/);
  assert.match(output, /Archived attempt QA passed\./);
});

test("sortArtifactsForDisplay prioritizes review and diff artifacts over raw repo files", () => {
  const ordered = sortArtifactsForDisplay([
    "fixture-trim-js/repo/package.json",
    "metrics.json",
    "review-task-1.patch",
    "events.jsonl",
    "review-task-1.md"
  ]);

  assert.deepEqual(ordered, [
    "review-task-1.patch",
    "review-task-1.md",
    "events.jsonl",
    "metrics.json",
    "fixture-trim-js/repo/package.json"
  ]);
});

test("buildArtifactPreview truncates long artifact content into a bounded viewport", () => {
  const preview = buildArtifactPreview(
    "review-task-2.patch",
    Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join("\n")
  );

  assert.equal(preview.artifact, "review-task-2.patch");
  assert.equal(preview.lines.length, 18);
  assert.equal(preview.lines[0], "line 1");
  assert.equal(preview.lines.at(-1), "line 18");
  assert.equal(preview.truncated, true);
});
