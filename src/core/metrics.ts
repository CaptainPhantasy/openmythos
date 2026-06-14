import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ContextResult, Plan, QaResult, ReviewBundle, TaskExecutionReceipt, TaskOutput } from "./types.js";
import type { ModelUsageMetric, RunMetrics, RunState } from "../state/types.js";

export interface VerificationMetrics {
  localVerificationCount: number;
  localVerificationFailureCount: number;
  taskVerificationCount: number;
  taskVerificationFailureCount: number;
}

export function buildRunMetrics(input: {
  state: RunState;
  context: ContextResult | null;
  plan: Plan | null;
  outputs: TaskOutput[] | null;
  taskReceipts: TaskExecutionReceipt[];
  qa: QaResult | null;
  reviews: ReviewBundle[];
  verification: VerificationMetrics;
  modelUsage: ModelUsageMetric[];
}): RunMetrics {
  const outputs = input.outputs ?? [];
  return {
    runId: input.state.runId,
    goal: input.state.goal,
    status: input.state.status,
    startedAt: input.state.startedAt,
    completedAt: input.state.completedAt,
    totalDurationMs: Math.max(
      0,
      Date.parse(input.state.completedAt ?? new Date().toISOString()) - Date.parse(input.state.startedAt)
    ),
    retryCount: input.state.retryCount,
    phaseCount: input.state.phasesCompleted.length,
    contextFileCount: input.context?.fileManifest.length ?? 0,
    taskCount: input.plan?.tasks.length ?? 0,
    modelTaskCount: input.taskReceipts.filter((receipt) => receipt.executorKind === "model").length,
    harnessTaskCount: input.taskReceipts.filter((receipt) => receipt.executorKind === "harness").length,
    modelToolTurnCount: input.taskReceipts.reduce((sum, receipt) => sum + (receipt.executorKind === "model" ? receipt.toolTurnCount : 0), 0),
    modelToolCallCount: input.taskReceipts.reduce((sum, receipt) => sum + (receipt.executorKind === "model" ? receipt.toolCallCount : 0), 0),
    fileEditCount: outputs.reduce((sum, output) => sum + output.fileEdits.length, 0),
    patchEditCount: outputs.reduce((sum, output) => sum + output.fileEdits.filter((edit) => edit.action === "patch").length, 0),
    deleteEditCount: outputs.reduce((sum, output) => sum + output.fileEdits.filter((edit) => edit.action === "delete").length, 0),
    highRiskReviewCount: input.reviews.reduce((sum, review) => sum + review.reviews.filter((entry) => entry.risk.level === "high").length, 0),
    blockingReviewCount: input.reviews.filter((review) => review.blocking).length,
    localVerificationCount: input.verification.localVerificationCount,
    localVerificationFailureCount: input.verification.localVerificationFailureCount,
    taskVerificationCount: input.verification.taskVerificationCount,
    taskVerificationFailureCount: input.verification.taskVerificationFailureCount,
    qaPassed: input.qa?.passed ?? null,
    qaScore: input.qa?.score ?? null,
    modelUsage: input.modelUsage
  };
}

export interface BenchmarkSummary {
  runCount: number;
  completedCount: number;
  failedCount: number;
  awaitingApprovalCount: number;
  averageDurationMs: number;
  averageQaScore: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalModelCalls: number;
  totalFileEdits: number;
  totalPatchEdits: number;
  totalModelTaskCount: number;
  totalHarnessTaskCount: number;
  totalModelToolTurnCount: number;
  totalModelToolCallCount: number;
  totalTaskVerificationCount: number;
  totalTaskVerificationFailures: number;
}

export function summarizeBench(metrics: RunMetrics[]): BenchmarkSummary {
  const runCount = metrics.length;
  const completedCount = metrics.filter((metric) => metric.status === "completed").length;
  const failedCount = metrics.filter((metric) => metric.status === "failed").length;
  const awaitingApprovalCount = metrics.filter((metric) => metric.status === "awaiting_approval").length;
  const averageDurationMs = runCount === 0
    ? 0
    : Math.round(metrics.reduce((sum, metric) => sum + metric.totalDurationMs, 0) / runCount);

  const qaScores = metrics.map((metric) => metric.qaScore).filter((score): score is number => typeof score === "number");
  const averageQaScore = qaScores.length === 0
    ? null
    : Number((qaScores.reduce((sum, score) => sum + score, 0) / qaScores.length).toFixed(2));

  const modelUsage = metrics.flatMap((metric) => metric.modelUsage);

  return {
    runCount,
    completedCount,
    failedCount,
    awaitingApprovalCount,
    averageDurationMs,
    averageQaScore,
    totalInputTokens: modelUsage.reduce((sum, usage) => sum + usage.inputTokens, 0),
    totalOutputTokens: modelUsage.reduce((sum, usage) => sum + usage.outputTokens, 0),
    totalModelCalls: modelUsage.reduce((sum, usage) => sum + usage.calls, 0),
    totalFileEdits: metrics.reduce((sum, metric) => sum + metric.fileEditCount, 0),
    totalPatchEdits: metrics.reduce((sum, metric) => sum + metric.patchEditCount, 0),
    totalModelTaskCount: metrics.reduce((sum, metric) => sum + metric.modelTaskCount, 0),
    totalHarnessTaskCount: metrics.reduce((sum, metric) => sum + metric.harnessTaskCount, 0),
    totalModelToolTurnCount: metrics.reduce((sum, metric) => sum + metric.modelToolTurnCount, 0),
    totalModelToolCallCount: metrics.reduce((sum, metric) => sum + metric.modelToolCallCount, 0),
    totalTaskVerificationCount: metrics.reduce((sum, metric) => sum + metric.taskVerificationCount, 0),
    totalTaskVerificationFailures: metrics.reduce((sum, metric) => sum + metric.taskVerificationFailureCount, 0)
  };
}

export async function collectRunMetrics(rootPath: string): Promise<RunMetrics[]> {
  const roots = await discoverMetricsRoots(resolve(rootPath), 0, 5);
  const metrics: RunMetrics[] = [];
  for (const root of roots) {
    const path = resolve(root, "metrics.json");
    if (!existsSync(path)) {
      continue;
    }
    metrics.push(JSON.parse(await readFile(path, "utf8")) as RunMetrics);
  }
  return metrics.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function discoverMetricsRoots(path: string, depth: number, maxDepth: number): Promise<string[]> {
  if (depth > maxDepth || !existsSync(path)) {
    return [];
  }
  const metricsPath = resolve(path, "metrics.json");
  if (existsSync(metricsPath)) {
    return [path];
  }

  const results: string[] = [];
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    results.push(...await discoverMetricsRoots(resolve(path, entry.name), depth + 1, maxDepth));
  }
  return results;
}
