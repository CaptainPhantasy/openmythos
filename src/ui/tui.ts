import readline from "node:readline";
import { summarizeBench } from "../core/metrics.js";
import { PHASES, type Plan, type TaskExecutionReceipt } from "../core/types.js";
import type { StateStore } from "../state/store.js";
import type { RunAttempt, RunEvent, RunMetrics, RunState } from "../state/types.js";
import type { RunResult } from "../core/runner.js";

const ARTIFACT_PREVIEW_LINE_LIMIT = 18;
const ARTIFACT_PREVIEW_COLUMN_LIMIT = 140;
const DEFAULT_REFRESH_MS = 400;

export interface ArtifactPreview {
  artifact: string;
  lines: string[];
  truncated: boolean;
}

export interface DashboardModel {
  runs: RunState[];
  selectedRun: RunState | null;
  attempts: RunAttempt[];
  selectedAttemptIndex: number;
  selectedAttempt: RunAttempt | null;
  events: RunEvent[];
  metrics: RunMetrics[];
  selectedMetrics: RunMetrics | null;
  selectedProgress: RunProgress | null;
  comparison: AttemptComparison | null;
  artifacts: string[];
  selectedArtifactIndex: number;
  selectedArtifact: string | null;
  artifactComparison: ArtifactComparison | null;
  artifactPreview: ArtifactPreview | null;
}

export interface RunProgress {
  completedPhaseCount: number;
  totalPhaseCount: number;
  plannedTaskCount: number | null;
  completedTaskCount: number;
  latestTask: {
    taskId: string;
    executorKind: TaskExecutionReceipt["executorKind"];
    executorRole: TaskExecutionReceipt["executorRole"];
    status: TaskExecutionReceipt["status"];
    summary: string;
  } | null;
  latestEvent: {
    phase: RunEvent["phase"];
    action: string;
    status: RunEvent["status"];
    summary: string;
  } | null;
}

export interface AttemptComparison {
  baselineAttempt: RunAttempt;
  baselineRelation: "older" | "newer";
  baselineMetrics: RunMetrics | null;
  baselineEventCount: number;
  baselineArtifactCount: number;
  durationDeltaMs: number | null;
  qaScoreDelta: number | null;
  fileEditDelta: number | null;
  patchEditDelta: number | null;
  taskVerificationDelta: number | null;
  eventCountDelta: number;
  addedArtifacts: string[];
  removedArtifacts: string[];
}

export interface ArtifactComparison {
  baselineAttempt: RunAttempt;
  baselineRelation: "older" | "newer";
  artifact: string;
  status: "added" | "changed" | "unchanged";
  selectedLineCount: number;
  baselineLineCount: number;
  differingLineCount: number;
  previewPairs: Array<{
    baseline: string | null;
    selected: string | null;
  }>;
}

export interface RunControlSurface {
  approve(runId: string): Promise<RunResult>;
  reject(runId: string, reason: string): Promise<RunResult>;
  cancel(runId: string, reason: string): Promise<RunResult>;
  queue(runId: string): Promise<RunResult>;
  replay(runId: string): Promise<RunResult>;
}

export interface TuiOptions {
  once?: boolean;
  refreshMs?: number;
  watchedRunId?: string;
  blockExitWhileActive?: boolean;
  controls?: RunControlSurface;
}

export function sortArtifactsForDisplay(artifacts: string[]): string[] {
  return [...artifacts].sort((left, right) => {
    const score = artifactPriority(left) - artifactPriority(right);
    if (score !== 0) {
      return score;
    }
    return left.localeCompare(right);
  });
}

export function buildArtifactPreview(artifact: string, content: string): ArtifactPreview {
  const normalized = content.replace(/\r/g, "");
  const sourceLines = normalized.split("\n");
  const previewLines = sourceLines.slice(0, ARTIFACT_PREVIEW_LINE_LIMIT).map((line) => (
    line.length > ARTIFACT_PREVIEW_COLUMN_LIMIT
      ? `${line.slice(0, ARTIFACT_PREVIEW_COLUMN_LIMIT - 1)}…`
      : line
  ));
  const truncated = sourceLines.length > ARTIFACT_PREVIEW_LINE_LIMIT
    || sourceLines.some((line) => line.length > ARTIFACT_PREVIEW_COLUMN_LIMIT);

  return {
    artifact,
    lines: previewLines.length > 0 ? previewLines : ["(empty artifact)"],
    truncated
  };
}

export async function loadDashboardModel(
  store: StateStore,
  selectedIndex = 0,
  requestedAttemptIndex = 0,
  requestedArtifactIndex = 0
): Promise<DashboardModel> {
  const runs = await store.listRuns();
  const selectedRun = runs[selectedIndex] ?? null;
  const attempts = selectedRun ? await store.listAttempts(selectedRun.runId) : [];
  const selectedAttemptIndex = attempts.length === 0
    ? 0
    : Math.min(Math.max(requestedAttemptIndex, 0), attempts.length - 1);
  const selectedAttempt = attempts[selectedAttemptIndex] ?? null;
  const selectedAttemptId = selectedAttempt?.attemptId ?? "current";
  const selectedAttemptState = selectedAttempt?.state ?? null;
  const events = selectedRun ? await store.loadAttemptEvents(selectedRun.runId, selectedAttemptId) : [];
  const metrics = (await Promise.all(runs.map(async (run) => ({
    runId: run.runId,
    metrics: await store.readArtifact<RunMetrics>(run.runId, "metrics.json")
  })))).flatMap((item) => item.metrics ? [item.metrics] : []);
  const selectedMetrics = selectedRun ? await store.readAttemptArtifact<RunMetrics>(selectedRun.runId, selectedAttemptId, "metrics.json") : null;
  const selectedPlan = selectedRun ? await store.readAttemptArtifact<Plan>(selectedRun.runId, selectedAttemptId, "plan.json") : null;
  const selectedReceipts = selectedRun ? await store.readAttemptArtifact<TaskExecutionReceipt[]>(selectedRun.runId, selectedAttemptId, "execution.json") : null;
  const selectedProgress = selectedAttemptState
    ? buildRunProgress(selectedAttemptState, selectedPlan, selectedReceipts, events)
    : null;
  const artifacts = selectedRun ? sortArtifactsForDisplay(await store.listAttemptArtifacts(selectedRun.runId, selectedAttemptId)) : [];
  const comparisonBase = resolveComparisonBaseline(attempts, selectedAttemptIndex);
  const comparison = selectedRun && selectedAttempt && comparisonBase
    ? await buildAttemptComparison(
      store,
      selectedRun.runId,
      comparisonBase,
      selectedMetrics,
      events,
      artifacts
    )
    : null;
  const selectedArtifactIndex = artifacts.length === 0
    ? 0
    : Math.min(Math.max(requestedArtifactIndex, 0), artifacts.length - 1);
  const selectedArtifact = artifacts[selectedArtifactIndex] ?? null;
  const artifactComparison = selectedRun && selectedArtifact && comparisonBase
    ? await buildArtifactComparison(
      store,
      selectedRun.runId,
      selectedAttemptId,
      selectedArtifact,
      comparisonBase
    )
    : null;
  const artifactPreview = selectedRun && selectedArtifact
    ? await loadArtifactPreview(store, selectedRun.runId, selectedAttemptId, selectedArtifact)
    : null;
  return {
    runs,
    selectedRun,
    attempts,
    selectedAttemptIndex,
    selectedAttempt,
    events,
    metrics,
    selectedMetrics,
    selectedProgress,
    comparison,
    artifacts,
    selectedArtifactIndex,
    selectedArtifact,
    artifactComparison,
    artifactPreview
  };
}

export function renderDashboard(model: DashboardModel, selectedIndex = 0): string {
  const lines: string[] = [];
  const bench = summarizeBench(model.metrics);
  const liveRunCount = model.runs.length;
  const liveCompletedCount = model.runs.filter((run) => run.status === "completed").length;
  const liveFailedCount = model.runs.filter((run) => run.status === "failed").length;
  const liveAwaitingApprovalCount = model.runs.filter((run) => run.status === "awaiting_approval").length;
  const liveQueuedCount = model.runs.filter((run) => run.status === "queued").length;

  lines.push("OpenMythos TUI");
  lines.push("Keys: j/down next run | k/up previous run | {/left previous attempt | }/right next attempt | [ previous artifact | ] next artifact | r refresh | a approve | x reject | c cancel | p queue | l replay | q quit");
  lines.push("");
  lines.push("Bench Summary");
  lines.push(`  runs=${liveRunCount} completed=${liveCompletedCount} failed=${liveFailedCount} awaiting=${liveAwaitingApprovalCount} queued=${liveQueuedCount}`);
  lines.push(`  avg_duration_ms=${bench.averageDurationMs} avg_qa=${bench.averageQaScore ?? "-"} model_calls=${bench.totalModelCalls}`);
  lines.push(`  task_routes: model=${bench.totalModelTaskCount} harness=${bench.totalHarnessTaskCount}`);
  lines.push(`  model_tool_loop: turns=${bench.totalModelToolTurnCount} calls=${bench.totalModelToolCallCount}`);
  lines.push(`  file_edits=${bench.totalFileEdits} patch_edits=${bench.totalPatchEdits} task_verification=${bench.totalTaskVerificationCount} failed_task_verification=${bench.totalTaskVerificationFailures}`);
  lines.push(`  input_tokens=${bench.totalInputTokens} output_tokens=${bench.totalOutputTokens}`);
  lines.push("");
  lines.push("Runs");

  if (model.runs.length === 0) {
    lines.push("  No runs found.");
    return lines.join("\n");
  }

  model.runs.forEach((run, index) => {
    const cursor = index === selectedIndex ? ">" : " ";
    lines.push(`${cursor} ${run.runId} ${run.status} phase=${run.currentPhase} retries=${run.retryCount}/${run.maxRetries}`);
    lines.push(`    ${run.goal.slice(0, 96)}`);
  });

  lines.push("");
  lines.push("Selected Run");
  if (!model.selectedRun) {
    lines.push("  None");
  } else {
    lines.push(`  id: ${model.selectedRun.runId}`);
    lines.push(`  status: ${model.selectedRun.status}`);
    lines.push(`  phase: ${model.selectedRun.currentPhase}`);
    lines.push(`  started: ${model.selectedRun.startedAt}`);
    lines.push(`  completed: ${model.selectedRun.completedAt ?? "-"}`);
    if (model.selectedRun.error) {
      lines.push(`  error: ${model.selectedRun.error}`);
    }
  }

  lines.push("");
  lines.push("Attempts");
  if (model.attempts.length === 0) {
    lines.push("  No attempts.");
  } else {
    for (const [index, attempt] of model.attempts.entries()) {
      const cursor = index === model.selectedAttemptIndex ? ">" : " ";
      lines.push(`${cursor} ${formatAttemptLabel(attempt)} ${formatAttemptStatus(attempt)}`);
    }
  }

  lines.push("");
  lines.push("Selected Attempt");
  if (!model.selectedAttempt) {
    lines.push("  None");
  } else {
    lines.push(`  id: ${model.selectedAttempt.attemptId}`);
    lines.push(`  kind: ${model.selectedAttempt.kind}`);
    lines.push(`  status: ${model.selectedAttempt.state?.status ?? "missing"}`);
    lines.push(`  phase: ${model.selectedAttempt.state?.currentPhase ?? "-"}`);
    lines.push(`  archived: ${model.selectedAttempt.archivedAt ?? "-"}`);
    lines.push(`  reason: ${model.selectedAttempt.reason ?? "-"}`);
  }

  lines.push("");
  lines.push("Attempt Comparison");
  if (!model.comparison) {
    lines.push("  No comparison baseline.");
  } else {
    lines.push(`  baseline: ${formatAttemptLabel(model.comparison.baselineAttempt)} (${model.comparison.baselineRelation} attempt)`);
    lines.push(`  baseline status: ${model.comparison.baselineAttempt.state?.status ?? "missing"} phase=${model.comparison.baselineAttempt.state?.currentPhase ?? "-"}`);
    lines.push(`  duration_ms delta: ${formatDelta(model.comparison.durationDeltaMs)}`);
    lines.push(`  qa_score delta: ${formatDelta(model.comparison.qaScoreDelta)}`);
    lines.push(`  file_edits delta: ${formatDelta(model.comparison.fileEditDelta)}`);
    lines.push(`  patch_edits delta: ${formatDelta(model.comparison.patchEditDelta)}`);
    lines.push(`  task_verification delta: ${formatDelta(model.comparison.taskVerificationDelta)}`);
    lines.push(`  events delta: ${formatDelta(model.comparison.eventCountDelta)}`);
    lines.push(`  artifacts delta: +${model.comparison.addedArtifacts.length} / -${model.comparison.removedArtifacts.length}`);
    if (model.comparison.addedArtifacts.length > 0) {
      lines.push(`  added vs baseline: ${summarizeArtifactDelta(model.comparison.addedArtifacts)}`);
    }
    if (model.comparison.removedArtifacts.length > 0) {
      lines.push(`  removed vs baseline: ${summarizeArtifactDelta(model.comparison.removedArtifacts)}`);
    }
  }

  lines.push("");
  lines.push("Progress");
  if (!model.selectedProgress) {
    lines.push("  No progress data.");
  } else {
    lines.push(`  phases: ${model.selectedProgress.completedPhaseCount}/${model.selectedProgress.totalPhaseCount}`);
    if (model.selectedProgress.plannedTaskCount === null) {
      lines.push("  tasks: -");
    } else {
      lines.push(`  tasks: ${model.selectedProgress.completedTaskCount}/${model.selectedProgress.plannedTaskCount}`);
    }
    if (model.selectedProgress.latestTask) {
      const latestTask = model.selectedProgress.latestTask;
      lines.push(`  latest task: ${latestTask.taskId} ${latestTask.executorKind}/${latestTask.executorRole} ${latestTask.status}`);
      lines.push(`    ${latestTask.summary}`);
    }
    if (model.selectedProgress.latestEvent) {
      const latestEvent = model.selectedProgress.latestEvent;
      lines.push(`  latest event: [${latestEvent.status}] ${latestEvent.phase}:${latestEvent.action}`);
      lines.push(`    ${latestEvent.summary}`);
    }
  }

  lines.push("");
  lines.push("Run Metrics");
  if (!model.selectedMetrics) {
    lines.push("  No metrics.json found.");
  } else {
    lines.push(`  duration_ms: ${model.selectedMetrics.totalDurationMs}`);
    lines.push(`  qa: ${model.selectedMetrics.qaPassed === null ? "-" : model.selectedMetrics.qaPassed} score=${model.selectedMetrics.qaScore ?? "-"}`);
    lines.push(`  context_files: ${model.selectedMetrics.contextFileCount} tasks: ${model.selectedMetrics.taskCount}`);
    lines.push(`  task_routes: model=${model.selectedMetrics.modelTaskCount} harness=${model.selectedMetrics.harnessTaskCount}`);
    lines.push(`  model_tool_loop: turns=${model.selectedMetrics.modelToolTurnCount} calls=${model.selectedMetrics.modelToolCallCount}`);
    lines.push(`  edits: ${model.selectedMetrics.fileEditCount} patch=${model.selectedMetrics.patchEditCount} delete=${model.selectedMetrics.deleteEditCount}`);
    lines.push(`  reviews: high=${model.selectedMetrics.highRiskReviewCount} blocking=${model.selectedMetrics.blockingReviewCount}`);
    lines.push(`  local_verification: total=${model.selectedMetrics.localVerificationCount} failed=${model.selectedMetrics.localVerificationFailureCount}`);
    lines.push(`  task_verification: total=${model.selectedMetrics.taskVerificationCount} failed=${model.selectedMetrics.taskVerificationFailureCount}`);
    if (model.selectedMetrics.modelUsage.length > 0) {
      lines.push("  model usage:");
      for (const usage of model.selectedMetrics.modelUsage.slice(0, 6)) {
        lines.push(`    ${usage.role} ${usage.model} calls=${usage.calls} in=${usage.inputTokens} out=${usage.outputTokens} ms=${usage.durationMs}`);
      }
    }
  }

  lines.push("");
  lines.push("Artifact Comparison");
  if (!model.artifactComparison) {
    lines.push("  No artifact comparison available.");
  } else {
    lines.push(`  baseline: ${formatAttemptLabel(model.artifactComparison.baselineAttempt)} (${model.artifactComparison.baselineRelation} attempt)`);
    lines.push(`  status: ${model.artifactComparison.status}`);
    lines.push(`  lines: selected=${model.artifactComparison.selectedLineCount} baseline=${model.artifactComparison.baselineLineCount}`);
    lines.push(`  differing lines: ${model.artifactComparison.differingLineCount}`);
    if (model.artifactComparison.previewPairs.length > 0) {
      for (const pair of model.artifactComparison.previewPairs) {
        lines.push(`    baseline: ${pair.baseline ?? "(missing)"}`);
        lines.push(`    selected: ${pair.selected ?? "(missing)"}`);
      }
    }
  }

  lines.push("");
  lines.push("Focused Artifact");
  if (!model.selectedArtifact || !model.artifactPreview) {
    lines.push("  No previewable artifact.");
  } else {
    lines.push(`  selected: ${model.selectedArtifact} (${model.selectedArtifactIndex + 1}/${model.artifacts.length})`);
    for (const previewLine of model.artifactPreview.lines) {
      lines.push(`    ${previewLine}`);
    }
    if (model.artifactPreview.truncated) {
      lines.push("    ... preview truncated");
    }
  }

  lines.push("");
  lines.push("Artifacts");
  if (model.artifacts.length === 0) {
    lines.push("  No artifacts.");
  } else {
    const start = model.artifacts.length <= 10
      ? 0
      : Math.min(
        Math.max(model.selectedArtifactIndex - 4, 0),
        Math.max(model.artifacts.length - 10, 0)
      );
    const visibleArtifacts = model.artifacts.slice(start, start + 10);
    for (const [offset, artifact] of visibleArtifacts.entries()) {
      const artifactIndex = start + offset;
      const cursor = artifactIndex === model.selectedArtifactIndex ? ">" : " ";
      lines.push(`${cursor} ${artifact}`);
    }
    if (model.artifacts.length > 10) {
      lines.push(`  ... showing ${Math.min(start + 10, model.artifacts.length)} of ${model.artifacts.length}`);
    }
  }

  lines.push("");
  lines.push("Recent Events");
  const recent = model.events.slice(-8);
  if (recent.length === 0) {
    lines.push("  No events.");
  } else {
    for (const event of recent) {
      lines.push(`  ${event.timestamp} [${event.status}] ${event.phase}:${event.action} ${event.summary}`);
      if (event.artifacts.length > 0) {
        lines.push(`    artifacts: ${event.artifacts.join(", ")}`);
      }
      if (event.nextActions.length > 0) {
        lines.push(`    next: ${event.nextActions.join(" | ")}`);
      }
    }
  }

  return lines.join("\n");
}

export async function runTui(store: StateStore, options: boolean | TuiOptions): Promise<void> {
  const normalizedOptions: TuiOptions = typeof options === "boolean"
    ? { once: options }
    : options;
  let selectedIndex = 0;
  let selectedAttemptIndex = 0;
  let selectedArtifactIndex = 0;
  let statusLine = "";
  let drawing = false;
  let redrawQueued = false;
  let refreshTimer: NodeJS.Timeout | null = null;

  const setStatusLine = (value: string): void => {
    statusLine = value;
  };

  const draw = async (): Promise<void> => {
    if (drawing) {
      redrawQueued = true;
      return;
    }
    drawing = true;
    try {
      const model = await loadDashboardModel(store, selectedIndex, selectedAttemptIndex, selectedArtifactIndex);
      if (selectedIndex >= model.runs.length) {
        selectedIndex = Math.max(0, model.runs.length - 1);
      }
      if (model.attempts.length > 0) {
        selectedAttemptIndex = Math.min(Math.max(selectedAttemptIndex, 0), model.attempts.length - 1);
      } else {
        selectedAttemptIndex = 0;
      }
      if (model.artifacts.length > 0) {
        selectedArtifactIndex = Math.min(Math.max(selectedArtifactIndex, 0), model.artifacts.length - 1);
      } else {
        selectedArtifactIndex = 0;
      }
      const normalized = await loadDashboardModel(store, selectedIndex, selectedAttemptIndex, selectedArtifactIndex);
      process.stdout.write("\x1b[2J\x1b[H");
      const output = renderDashboard(normalized, selectedIndex);
      process.stdout.write(statusLine ? `${output}\n\nStatus: ${statusLine}\n` : `${output}\n`);
    } finally {
      drawing = false;
      if (redrawQueued) {
        redrawQueued = false;
        void draw();
      }
    }
  };

  await draw();
  if (normalizedOptions.once || !process.stdin.isTTY) {
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  refreshTimer = setInterval(() => {
    void draw();
  }, normalizedOptions.refreshMs ?? DEFAULT_REFRESH_MS);

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
      process.stdin.setRawMode(false);
      process.stdin.off("keypress", onKeypress);
      resolve();
    };

    const executeControl = (summary: string, work: () => Promise<unknown>): void => {
      setStatusLine(summary);
      void work()
        .then(() => {
          void draw();
        })
        .catch((error: Error) => {
          setStatusLine(error.message);
          void draw();
        });
    };

    const onKeypress = async (_chunk: string, key: readline.Key): Promise<void> => {
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        if (normalizedOptions.blockExitWhileActive && normalizedOptions.watchedRunId) {
          const watchedRun = await store.loadRun(normalizedOptions.watchedRunId);
          if (watchedRun?.status === "running") {
            setStatusLine(`Run ${normalizedOptions.watchedRunId} is still active. Use c to cancel or wait for completion.`);
            await draw();
            return;
          }
        }
        finish();
        return;
      }
      const model = await loadDashboardModel(store, selectedIndex, selectedAttemptIndex, selectedArtifactIndex);
      const selectedRun = model.selectedRun;
      if (key.name === "a" && selectedRun?.status === "awaiting_approval") {
        if (!normalizedOptions.controls) {
          setStatusLine("Run controls are unavailable in read-only TUI mode.");
          await draw();
          return;
        }
        executeControl(
          `Approving ${selectedRun.runId} and resuming execution...`,
          async () => {
            await normalizedOptions.controls?.approve(selectedRun.runId);
            selectedAttemptIndex = 0;
            selectedArtifactIndex = 0;
            setStatusLine(`Run ${selectedRun.runId} resumed after approval.`);
          }
        );
        await draw();
        return;
      }
      if (key.name === "x" && selectedRun && selectedRun.status !== "completed") {
        if (!normalizedOptions.controls) {
          setStatusLine("Run controls are unavailable in read-only TUI mode.");
          await draw();
          return;
        }
        executeControl(
          `Rejecting ${selectedRun.runId}...`,
          async () => {
            await normalizedOptions.controls?.reject(selectedRun.runId, "Rejected from TUI.");
            selectedAttemptIndex = 0;
            selectedArtifactIndex = 0;
            setStatusLine(`Run ${selectedRun.runId} rejected.`);
          }
        );
        await draw();
        return;
      }
      if (key.name === "c" && selectedRun) {
        if (!normalizedOptions.controls) {
          setStatusLine("Run controls are unavailable in read-only TUI mode.");
          await draw();
          return;
        }
        executeControl(
          `Cancelling ${selectedRun.runId}...`,
          async () => {
            await normalizedOptions.controls?.cancel(selectedRun.runId, "Cancelled from TUI.");
            selectedAttemptIndex = 0;
            selectedArtifactIndex = 0;
            setStatusLine(`Run ${selectedRun.runId} cancelled.`);
          }
        );
        await draw();
        return;
      }
      if (key.name === "p" && selectedRun && selectedRun.status !== "running" && selectedRun.status !== "queued") {
        if (!normalizedOptions.controls) {
          setStatusLine("Run controls are unavailable in read-only TUI mode.");
          await draw();
          return;
        }
        executeControl(
          `Queueing ${selectedRun.runId}...`,
          async () => {
            await normalizedOptions.controls?.queue(selectedRun.runId);
            selectedAttemptIndex = 0;
            selectedArtifactIndex = 0;
            setStatusLine(`Run ${selectedRun.runId} queued.`);
          }
        );
        await draw();
        return;
      }
      if (key.name === "l" && selectedRun && selectedRun.status !== "running") {
        if (!normalizedOptions.controls) {
          setStatusLine("Run controls are unavailable in read-only TUI mode.");
          await draw();
          return;
        }
        executeControl(
          `Replaying ${selectedRun.runId}...`,
          async () => {
            await normalizedOptions.controls?.replay(selectedRun.runId);
            selectedAttemptIndex = 0;
            selectedArtifactIndex = 0;
            setStatusLine(`Run ${selectedRun.runId} queued for replay.`);
          }
        );
        await draw();
        return;
      }
      if (key.sequence === "{" || key.name === "left") {
        if (model.attempts.length > 0) {
          selectedAttemptIndex = Math.max(0, selectedAttemptIndex - 1);
          selectedArtifactIndex = 0;
        }
        await draw();
        return;
      }
      if (key.sequence === "}" || key.name === "right") {
        if (model.attempts.length > 0) {
          selectedAttemptIndex = Math.min(model.attempts.length - 1, selectedAttemptIndex + 1);
          selectedArtifactIndex = 0;
        }
        await draw();
        return;
      }
      if (key.name === "r") {
        await draw();
        return;
      }
      if (key.sequence === "[") {
        if (model.artifacts.length > 0) {
          selectedArtifactIndex = Math.max(0, selectedArtifactIndex - 1);
        }
        await draw();
        return;
      }
      if (key.sequence === "]") {
        if (model.artifacts.length > 0) {
          selectedArtifactIndex = Math.min(model.artifacts.length - 1, selectedArtifactIndex + 1);
        }
        await draw();
        return;
      }
      if (key.name === "j" || key.name === "down") {
        selectedIndex += 1;
        selectedAttemptIndex = 0;
        selectedArtifactIndex = 0;
      }
      if (key.name === "k" || key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        selectedAttemptIndex = 0;
        selectedArtifactIndex = 0;
      }
      await draw();
    };
    process.stdin.on("keypress", onKeypress);
  });
}

function artifactPriority(artifact: string): number {
  if (artifact.endsWith(".patch")) {
    return 0;
  }
  if (/diff[-._]/i.test(artifact) || /git-diff/i.test(artifact) || artifact.endsWith("diff-stat.txt")) {
    return 1;
  }
  if (/review-.*\.md$/i.test(artifact) || /review-t.*\.md$/i.test(artifact)) {
    return 2;
  }
  if (/tool-approval/i.test(artifact)) {
    return 3;
  }
  if (/events\.jsonl$/i.test(artifact)) {
    return 4;
  }
  if (/(metrics|qa|execution|governance|state)\.json$/i.test(artifact)) {
    return 5;
  }
  if (/(task-observation|task-tool-turns|task-dependencies|task-snippets)/i.test(artifact)) {
    return 6;
  }
  if (/review-.*\.json$/i.test(artifact) || /review-t.*\.json$/i.test(artifact)) {
    return 7;
  }
  if (/\/repo\//i.test(artifact)) {
    return 20;
  }
  return 10;
}

function buildRunProgress(
  run: RunState,
  plan: Plan | null,
  receipts: TaskExecutionReceipt[] | null,
  events: RunEvent[]
): RunProgress {
  const latestTaskReceipt = receipts?.at(-1) ?? null;
  const latestEvent = events.at(-1) ?? null;

  return {
    completedPhaseCount: Math.min(run.phasesCompleted.length, PHASES.length),
    totalPhaseCount: PHASES.length,
    plannedTaskCount: plan?.tasks.length ?? null,
    completedTaskCount: receipts?.length ?? 0,
    latestTask: latestTaskReceipt ? {
      taskId: latestTaskReceipt.taskId,
      executorKind: latestTaskReceipt.executorKind,
      executorRole: latestTaskReceipt.executorRole,
      status: latestTaskReceipt.status,
      summary: latestTaskReceipt.summary
    } : null,
    latestEvent: latestEvent ? {
      phase: latestEvent.phase,
      action: latestEvent.action,
      status: latestEvent.status,
      summary: latestEvent.summary
    } : null
  };
}

async function buildAttemptComparison(
  store: StateStore,
  runId: string,
  comparisonBase: ComparisonBase,
  selectedMetrics: RunMetrics | null,
  selectedEvents: RunEvent[],
  selectedArtifacts: string[]
): Promise<AttemptComparison> {
  const baselineAttempt = comparisonBase.attempt;
  const baselineAttemptId = baselineAttempt.attemptId;
  const baselineMetrics = await store.readAttemptArtifact<RunMetrics>(runId, baselineAttemptId, "metrics.json");
  const baselineEvents = await store.loadAttemptEvents(runId, baselineAttemptId);
  const baselineArtifacts = sortArtifactsForDisplay(await store.listAttemptArtifacts(runId, baselineAttemptId));

  return {
    baselineAttempt,
    baselineRelation: comparisonBase.relation,
    baselineMetrics,
    baselineEventCount: baselineEvents.length,
    baselineArtifactCount: baselineArtifacts.length,
    durationDeltaMs: computeMetricDelta(selectedMetrics?.totalDurationMs, baselineMetrics?.totalDurationMs),
    qaScoreDelta: computeMetricDelta(selectedMetrics?.qaScore, baselineMetrics?.qaScore),
    fileEditDelta: computeMetricDelta(selectedMetrics?.fileEditCount, baselineMetrics?.fileEditCount),
    patchEditDelta: computeMetricDelta(selectedMetrics?.patchEditCount, baselineMetrics?.patchEditCount),
    taskVerificationDelta: computeMetricDelta(selectedMetrics?.taskVerificationCount, baselineMetrics?.taskVerificationCount),
    eventCountDelta: selectedEvents.length - baselineEvents.length,
    addedArtifacts: selectedArtifacts.filter((artifact) => !baselineArtifacts.includes(artifact)),
    removedArtifacts: baselineArtifacts.filter((artifact) => !selectedArtifacts.includes(artifact))
  };
}

async function buildArtifactComparison(
  store: StateStore,
  runId: string,
  selectedAttemptId: string,
  artifact: string,
  comparisonBase: ComparisonBase
): Promise<ArtifactComparison | null> {
  const selectedContent = await store.readAttemptArtifactText(runId, selectedAttemptId, artifact);
  if (selectedContent === null) {
    return null;
  }

  const baselineContent = await store.readAttemptArtifactText(runId, comparisonBase.attempt.attemptId, artifact);
  const selectedLines = normalizeArtifactLines(selectedContent);
  const baselineLines = baselineContent === null ? [] : normalizeArtifactLines(baselineContent);
  const previewPairs = collectDifferingLinePairs(selectedLines, baselineLines, baselineContent === null);

  return {
    baselineAttempt: comparisonBase.attempt,
    baselineRelation: comparisonBase.relation,
    artifact,
    status: baselineContent === null
      ? "added"
      : selectedContent === baselineContent
        ? "unchanged"
        : "changed",
    selectedLineCount: selectedLines.length,
    baselineLineCount: baselineLines.length,
    differingLineCount: countDifferingLines(selectedLines, baselineLines, baselineContent === null),
    previewPairs
  };
}

async function loadArtifactPreview(
  store: StateStore,
  runId: string,
  attemptId: string,
  artifact: string
): Promise<ArtifactPreview | null> {
  try {
    const content = await store.readAttemptArtifactText(runId, attemptId, artifact);
    if (content === null) {
      return null;
    }
    return buildArtifactPreview(artifact, content);
  } catch (error) {
    return {
      artifact,
      lines: [`Failed to load artifact preview: ${(error as Error).message}`],
      truncated: false
    };
  }
}

function formatAttemptLabel(attempt: RunAttempt): string {
  if (attempt.kind === "current") {
    return "current";
  }
  const archived = attempt.archivedAt ?? attempt.attemptId;
  return `${attempt.reason ?? "history"}@${archived}`;
}

function formatAttemptStatus(attempt: RunAttempt): string {
  if (!attempt.state) {
    return "status=missing";
  }
  return `status=${attempt.state.status} phase=${attempt.state.currentPhase}`;
}

interface ComparisonBase {
  attempt: RunAttempt;
  relation: "older" | "newer";
}

function resolveComparisonBaseline(attempts: RunAttempt[], selectedAttemptIndex: number): ComparisonBase | null {
  if (attempts.length < 2) {
    return null;
  }
  if (selectedAttemptIndex === 0) {
    const olderAttempt = attempts[1];
    return olderAttempt ? { attempt: olderAttempt, relation: "older" } : null;
  }
  const newerAttempt = attempts[selectedAttemptIndex - 1];
  return newerAttempt ? { attempt: newerAttempt, relation: "newer" } : null;
}

function computeMetricDelta(selected: number | null | undefined, baseline: number | null | undefined): number | null {
  if (selected === null || selected === undefined || baseline === null || baseline === undefined) {
    return null;
  }
  return selected - baseline;
}

function formatDelta(value: number | null): string {
  if (value === null) {
    return "unavailable";
  }
  return value > 0 ? `+${value}` : `${value}`;
}

function summarizeArtifactDelta(artifacts: string[]): string {
  const limit = 4;
  if (artifacts.length <= limit) {
    return artifacts.join(", ");
  }
  return `${artifacts.slice(0, limit).join(", ")} ... +${artifacts.length - limit} more`;
}

function normalizeArtifactLines(content: string): string[] {
  return content.replace(/\r/g, "").split("\n");
}

function countDifferingLines(
  selectedLines: string[],
  baselineLines: string[],
  baselineMissing: boolean
): number {
  if (baselineMissing) {
    return selectedLines.length;
  }
  let differingLineCount = 0;
  const maxLines = Math.max(selectedLines.length, baselineLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    if ((selectedLines[index] ?? null) !== (baselineLines[index] ?? null)) {
      differingLineCount += 1;
    }
  }
  return differingLineCount;
}

function collectDifferingLinePairs(
  selectedLines: string[],
  baselineLines: string[],
  baselineMissing: boolean
): Array<{ baseline: string | null; selected: string | null }> {
  const previewLimit = 4;
  const pairs: Array<{ baseline: string | null; selected: string | null }> = [];

  if (baselineMissing) {
    for (const line of selectedLines.slice(0, previewLimit)) {
      pairs.push({ baseline: null, selected: line });
    }
    return pairs;
  }

  const maxLines = Math.max(selectedLines.length, baselineLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    const selected = selectedLines[index] ?? null;
    const baseline = baselineLines[index] ?? null;
    if (selected === baseline) {
      continue;
    }
    pairs.push({ baseline, selected });
    if (pairs.length >= previewLimit) {
      break;
    }
  }

  return pairs;
}
