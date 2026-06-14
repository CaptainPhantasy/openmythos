import readline from "node:readline";
import { summarizeBench } from "../core/metrics.js";
import type { StateStore } from "../state/store.js";
import type { RunEvent, RunMetrics, RunState } from "../state/types.js";

export interface DashboardModel {
  runs: RunState[];
  selectedRun: RunState | null;
  events: RunEvent[];
  metrics: RunMetrics[];
  selectedMetrics: RunMetrics | null;
  artifacts: string[];
}

export async function loadDashboardModel(store: StateStore, selectedIndex = 0): Promise<DashboardModel> {
  const runs = await store.listRuns();
  const selectedRun = runs[selectedIndex] ?? null;
  const events = selectedRun ? await store.loadEvents(selectedRun.runId) : [];
  const metrics = (await Promise.all(runs.map(async (run) => ({
    runId: run.runId,
    metrics: await store.readArtifact<RunMetrics>(run.runId, "metrics.json")
  })))).flatMap((item) => item.metrics ? [item.metrics] : []);
  const selectedMetrics = selectedRun ? await store.readArtifact<RunMetrics>(selectedRun.runId, "metrics.json") : null;
  const artifacts = selectedRun ? await store.listArtifacts(selectedRun.runId) : [];
  return { runs, selectedRun, events, metrics, selectedMetrics, artifacts };
}

export function renderDashboard(model: DashboardModel, selectedIndex = 0): string {
  const lines: string[] = [];
  const bench = summarizeBench(model.metrics);

  lines.push("OpenMythos TUI");
  lines.push("Keys: j/down next | k/up previous | r refresh | q quit");
  lines.push("");
  lines.push("Bench Summary");
  lines.push(`  runs=${bench.runCount} completed=${bench.completedCount} failed=${bench.failedCount} awaiting=${bench.awaitingApprovalCount}`);
  lines.push(`  avg_duration_ms=${bench.averageDurationMs} avg_qa=${bench.averageQaScore ?? "-"} model_calls=${bench.totalModelCalls}`);
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
  lines.push("Run Metrics");
  if (!model.selectedMetrics) {
    lines.push("  No metrics.json found.");
  } else {
    lines.push(`  duration_ms: ${model.selectedMetrics.totalDurationMs}`);
    lines.push(`  qa: ${model.selectedMetrics.qaPassed === null ? "-" : model.selectedMetrics.qaPassed} score=${model.selectedMetrics.qaScore ?? "-"}`);
    lines.push(`  context_files: ${model.selectedMetrics.contextFileCount} tasks: ${model.selectedMetrics.taskCount}`);
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
  lines.push("Artifacts");
  if (model.artifacts.length === 0) {
    lines.push("  No artifacts.");
  } else {
    for (const artifact of model.artifacts.slice(0, 10)) {
      lines.push(`  ${artifact}`);
    }
    if (model.artifacts.length > 10) {
      lines.push(`  ... ${model.artifacts.length - 10} more`);
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

export async function runTui(store: StateStore, once: boolean): Promise<void> {
  let selectedIndex = 0;

  const draw = async (): Promise<void> => {
    const model = await loadDashboardModel(store, selectedIndex);
    if (selectedIndex >= model.runs.length) {
      selectedIndex = Math.max(0, model.runs.length - 1);
    }
    const normalized = await loadDashboardModel(store, selectedIndex);
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(`${renderDashboard(normalized, selectedIndex)}\n`);
  };

  await draw();
  if (once || !process.stdin.isTTY) {
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  await new Promise<void>((resolve) => {
    const onKeypress = async (_chunk: string, key: readline.Key): Promise<void> => {
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        process.stdin.setRawMode(false);
        process.stdin.off("keypress", onKeypress);
        resolve();
        return;
      }
      if (key.name === "j" || key.name === "down") {
        selectedIndex += 1;
      }
      if (key.name === "k" || key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
      }
      await draw();
    };
    process.stdin.on("keypress", onKeypress);
  });
}
