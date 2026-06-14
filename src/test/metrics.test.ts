import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { collectRunMetrics, summarizeBench } from "../core/metrics.js";
import type { RunMetrics } from "../state/types.js";

test("summarizeBench aggregates retained run metrics", () => {
  const metrics: RunMetrics[] = [
    {
      runId: "run-1",
      goal: "goal 1",
      status: "completed",
      startedAt: "2026-06-14T00:00:00.000Z",
      completedAt: "2026-06-14T00:00:01.000Z",
      totalDurationMs: 1000,
      retryCount: 0,
      phaseCount: 6,
      contextFileCount: 3,
      taskCount: 2,
      modelTaskCount: 2,
      harnessTaskCount: 0,
      modelToolTurnCount: 1,
      modelToolCallCount: 2,
      fileEditCount: 4,
      patchEditCount: 1,
      deleteEditCount: 0,
      highRiskReviewCount: 0,
      blockingReviewCount: 0,
      localVerificationCount: 2,
      localVerificationFailureCount: 0,
      taskVerificationCount: 2,
      taskVerificationFailureCount: 0,
      qaPassed: true,
      qaScore: 100,
      modelUsage: [
        { role: "planner", model: "glm-5.1", calls: 2, inputTokens: 100, outputTokens: 50, durationMs: 200 }
      ]
    },
    {
      runId: "run-2",
      goal: "goal 2",
      status: "failed",
      startedAt: "2026-06-14T00:00:00.000Z",
      completedAt: "2026-06-14T00:00:02.000Z",
      totalDurationMs: 2000,
      retryCount: 1,
      phaseCount: 5,
      contextFileCount: 4,
      taskCount: 3,
      modelTaskCount: 2,
      harnessTaskCount: 1,
      modelToolTurnCount: 2,
      modelToolCallCount: 3,
      fileEditCount: 2,
      patchEditCount: 0,
      deleteEditCount: 1,
      highRiskReviewCount: 1,
      blockingReviewCount: 0,
      localVerificationCount: 1,
      localVerificationFailureCount: 1,
      taskVerificationCount: 1,
      taskVerificationFailureCount: 1,
      qaPassed: false,
      qaScore: 40,
      modelUsage: [
        { role: "coder", model: "glm-5.1", calls: 1, inputTokens: 30, outputTokens: 10, durationMs: 100 }
      ]
    }
  ];

  const summary = summarizeBench(metrics);
  assert.equal(summary.runCount, 2);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.averageDurationMs, 1500);
  assert.equal(summary.averageQaScore, 70);
  assert.equal(summary.totalInputTokens, 130);
  assert.equal(summary.totalPatchEdits, 1);
  assert.equal(summary.totalModelTaskCount, 4);
  assert.equal(summary.totalHarnessTaskCount, 1);
  assert.equal(summary.totalModelToolTurnCount, 3);
  assert.equal(summary.totalModelToolCallCount, 5);
  assert.equal(summary.totalTaskVerificationCount, 3);
  assert.equal(summary.totalTaskVerificationFailures, 1);
});

test("collectRunMetrics finds metrics artifacts under eval-style nested roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmythos-bench-"));
  const runRoot = resolve(root, "eval-1", "round-01", "runs", "run-1");
  await mkdir(runRoot, { recursive: true });
  await writeFile(resolve(runRoot, "metrics.json"), JSON.stringify({
    runId: "run-1",
    goal: "goal",
    status: "completed",
    startedAt: "2026-06-14T00:00:00.000Z",
    completedAt: "2026-06-14T00:00:01.000Z",
    totalDurationMs: 1000,
    retryCount: 0,
    phaseCount: 6,
    contextFileCount: 1,
    taskCount: 1,
    modelTaskCount: 1,
    harnessTaskCount: 0,
    modelToolTurnCount: 0,
    modelToolCallCount: 0,
    fileEditCount: 1,
    patchEditCount: 0,
    deleteEditCount: 0,
    highRiskReviewCount: 0,
    blockingReviewCount: 0,
    localVerificationCount: 0,
    localVerificationFailureCount: 0,
    taskVerificationCount: 0,
    taskVerificationFailureCount: 0,
    qaPassed: true,
    qaScore: 100,
    modelUsage: []
  }, null, 2));

  const metrics = await collectRunMetrics(root);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0]?.runId, "run-1");
});
