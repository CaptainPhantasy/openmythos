import readline from "node:readline";
import type { StateStore } from "../state/store.js";
import type { RunEvent, RunState } from "../state/types.js";

export interface DashboardModel {
  runs: RunState[];
  selectedRun: RunState | null;
  events: RunEvent[];
}

export async function loadDashboardModel(store: StateStore, selectedIndex = 0): Promise<DashboardModel> {
  const runs = await store.listRuns();
  const selectedRun = runs[selectedIndex] ?? null;
  const events = selectedRun ? await store.loadEvents(selectedRun.runId) : [];
  return { runs, selectedRun, events };
}

export function renderDashboard(model: DashboardModel, selectedIndex = 0): string {
  const lines: string[] = [];
  lines.push("OpenMythos TUI");
  lines.push("Keys: j/down next | k/up previous | r refresh | q quit");
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
  lines.push("Recent Events");
  const recent = model.events.slice(-8);
  if (recent.length === 0) {
    lines.push("  No events.");
  } else {
    for (const event of recent) {
      lines.push(`  ${event.timestamp} [${event.status}] ${event.phase}:${event.action} ${event.summary}`);
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
