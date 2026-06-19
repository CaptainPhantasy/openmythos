import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { PHASES, type Phase } from "../core/types.js";
import type { RunAttempt, RunAttemptArchive, RunEvent, RunMetrics, RunState } from "./types.js";

export class StateStore {
  constructor(private readonly baseDir: string) {}

  async createRun(runId: string, goal: string, maxRetries: number): Promise<string> {
    const runDir = this.runDir(runId);
    await mkdir(runDir, { recursive: true });
    const state: RunState = {
      runId,
      goal,
      status: "running",
      approved: false,
      currentPhase: "intake",
      phasesCompleted: [],
      retryCount: 0,
      maxRetries,
      startedAt: new Date().toISOString(),
      completedAt: null,
      finalOutput: null,
      error: null
    };
    await this.saveState(state);
    return runDir;
  }

  runDir(runId: string): string {
    return resolve(this.baseDir, runId);
  }

  async loadRun(runId: string): Promise<RunState | null> {
    const path = resolve(this.runDir(runId), "state.json");
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(await readFile(path, "utf8")) as RunState;
  }

  async saveState(state: RunState): Promise<void> {
    await mkdir(this.runDir(state.runId), { recursive: true });
    await writeAtomically(resolve(this.runDir(state.runId), "state.json"), JSON.stringify(state, null, 2));
  }

  async updatePhase(runId: string, phase: Phase): Promise<RunState> {
    const state = await this.mustLoad(runId);
    state.currentPhase = phase;
    if (!state.phasesCompleted.includes(phase)) {
      state.phasesCompleted.push(phase);
    }
    await this.saveState(state);
    return state;
  }

  async incrementRetry(runId: string): Promise<RunState> {
    const state = await this.mustLoad(runId);
    state.retryCount += 1;
    await this.saveState(state);
    return state;
  }

  async complete(runId: string, finalOutput: string): Promise<RunState> {
    const state = await this.mustLoad(runId);
    state.status = "completed";
    state.currentPhase = "complete";
    if (!state.phasesCompleted.includes("complete")) {
      state.phasesCompleted.push("complete");
    }
    state.completedAt = new Date().toISOString();
    state.finalOutput = finalOutput;
    await this.saveState(state);
    return state;
  }

  async awaitApproval(runId: string, error: string): Promise<RunState> {
    const state = await this.mustLoad(runId);
    state.status = "awaiting_approval";
    state.error = error;
    state.approved = false;
    await this.saveState(state);
    return state;
  }

  async approve(runId: string): Promise<RunState> {
    const state = await this.mustLoad(runId);
    if (state.status !== "awaiting_approval") {
      return state;
    }
    state.status = "running";
    state.error = null;
    state.approved = true;
    await this.saveState(state);
    return state;
  }

  async reject(runId: string, reason: string): Promise<RunState> {
    const state = await this.mustLoad(runId);
    state.approved = false;
    state.status = "failed";
    state.completedAt = new Date().toISOString();
    state.error = reason;
    await this.saveState(state);
    return state;
  }

  async queue(runId: string): Promise<RunState> {
    const state = await this.mustLoad(runId);
    await this.archiveCurrentArtifacts(runId, state);
    state.status = "queued";
    state.approved = false;
    state.currentPhase = "intake";
    state.phasesCompleted = [];
    state.startedAt = new Date().toISOString();
    state.completedAt = null;
    state.finalOutput = null;
    state.error = null;
    state.retryCount = 0;
    await this.saveState(state);
    return state;
  }

  async startQueuedRun(runId: string): Promise<RunState> {
    const state = await this.mustLoad(runId);
    if (state.status !== "queued") {
      return state;
    }
    state.status = "running";
    state.startedAt = new Date().toISOString();
    state.completedAt = null;
    state.finalOutput = null;
    state.error = null;
    state.currentPhase = "intake";
    state.phasesCompleted = [];
    state.retryCount = 0;
    await this.saveState(state);
    return state;
  }

  async fail(runId: string, error: string): Promise<RunState> {
    const state = await this.mustLoad(runId);
    state.status = "failed";
    state.completedAt = new Date().toISOString();
    state.error = error;
    await this.saveState(state);
    return state;
  }

  async emit(runId: string, event: Omit<RunEvent, "timestamp">): Promise<void> {
    const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    await writeFile(resolve(this.runDir(runId), "events.jsonl"), `${line}\n`, { flag: "a" });
  }

  async loadEvents(runId: string): Promise<RunEvent[]> {
    return this.loadAttemptEvents(runId);
  }

  async loadAttemptEvents(runId: string, attemptId = "current"): Promise<RunEvent[]> {
    const path = resolve(this.attemptDir(runId, attemptId), "events.jsonl");
    if (!existsSync(path)) {
      return [];
    }
    const text = await readFile(path, "utf8");
    return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunEvent);
  }

  async writeArtifact(runId: string, name: string, value: unknown): Promise<string> {
    const path = resolve(this.runDir(runId), name);
    const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    await writeAtomically(path, content);
    return path;
  }

  async readArtifact<T>(runId: string, name: string): Promise<T | null> {
    return this.readAttemptArtifact(runId, "current", name);
  }

  async readAttemptArtifact<T>(runId: string, attemptId: string, name: string): Promise<T | null> {
    const path = resolve(this.attemptDir(runId, attemptId), name);
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(await readFile(path, "utf8")) as T;
  }

  async readArtifactText(runId: string, name: string): Promise<string | null> {
    return this.readAttemptArtifactText(runId, "current", name);
  }

  async readAttemptArtifactText(runId: string, attemptId: string, name: string): Promise<string | null> {
    const path = resolve(this.attemptDir(runId, attemptId), name);
    if (!existsSync(path)) {
      return null;
    }
    return readFile(path, "utf8");
  }

  async listRuns(): Promise<RunState[]> {
    if (!existsSync(this.baseDir)) {
      return [];
    }
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const states: RunState[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const state = await this.loadRun(entry.name);
        if (state) {
          states.push(state);
        }
      } catch {
        continue;
      }
    }
    return states.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listArtifacts(runId: string): Promise<string[]> {
    return this.listAttemptArtifacts(runId);
  }

  async listAttemptArtifacts(runId: string, attemptId = "current"): Promise<string[]> {
    const root = this.attemptDir(runId, attemptId);
    if (!existsSync(root)) {
      return [];
    }
    return walkArtifacts(root, root);
  }

  async listAttempts(runId: string): Promise<RunAttempt[]> {
    const root = this.runDir(runId);
    if (!existsSync(root)) {
      return [];
    }

    const attempts: RunAttempt[] = [{
      attemptId: "current",
      kind: "current",
      archivedAt: null,
      reason: null,
      state: await this.loadRun(runId)
    }];

    const historyRoot = resolve(root, ".history");
    if (!existsSync(historyRoot)) {
      return attempts;
    }

    const entries = await readdir(historyRoot, { withFileTypes: true });
    const historyDirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.includes(".tmp-"))
      .sort((left, right) => right.name.localeCompare(left.name));

    for (const entry of historyDirs) {
      const manifest = await this.readAttemptManifest(resolve(historyRoot, entry.name, "attempt.json"));
      attempts.push({
        attemptId: entry.name,
        kind: "history",
        archivedAt: manifest?.archivedAt ?? null,
        reason: manifest?.reason ?? null,
        state: await this.loadAttemptState(runId, entry.name)
      });
    }

    return attempts;
  }

  async loadAttemptState(runId: string, attemptId: string): Promise<RunState | null> {
    const path = resolve(this.attemptDir(runId, attemptId), "state.json");
    if (!existsSync(path)) {
      return this.buildLegacyAttemptState(runId, attemptId);
    }
    return JSON.parse(await readFile(path, "utf8")) as RunState;
  }

  attemptDir(runId: string, attemptId = "current"): string {
    return attemptId === "current"
      ? this.runDir(runId)
      : resolve(this.runDir(runId), ".history", attemptId);
  }

  private async archiveCurrentArtifacts(runId: string, stateSnapshot: RunState): Promise<void> {
    const root = this.runDir(runId);
    if (!existsSync(root)) {
      return;
    }

    const entries = await readdir(root, { withFileTypes: true });
    const archiveEntries = entries.filter((entry) => entry.name !== "state.json" && entry.name !== ".history");
    if (archiveEntries.length === 0) {
      return;
    }

    const archiveDir = resolve(root, ".history", `queue-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    await mkdir(archiveDir, { recursive: true });
    await writeAtomically(resolve(archiveDir, "state.json"), JSON.stringify(stateSnapshot, null, 2));
    const manifest: RunAttemptArchive = {
      archivedAt: new Date().toISOString(),
      reason: "queue",
      sourceStatus: stateSnapshot.status,
      sourcePhase: stateSnapshot.currentPhase,
      sourceStartedAt: stateSnapshot.startedAt,
      sourceCompletedAt: stateSnapshot.completedAt,
      sourceError: stateSnapshot.error
    };
    await writeAtomically(resolve(archiveDir, "attempt.json"), JSON.stringify(manifest, null, 2));
    for (const entry of archiveEntries) {
      await rename(resolve(root, entry.name), resolve(archiveDir, entry.name));
    }
  }

  private async mustLoad(runId: string): Promise<RunState> {
    const state = await this.loadRun(runId);
    if (!state) {
      throw new Error(`Run not found: ${runId}`);
    }
    return state;
  }

  private async readAttemptManifest(path: string): Promise<RunAttemptArchive | null> {
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(await readFile(path, "utf8")) as RunAttemptArchive;
  }

  private async buildLegacyAttemptState(runId: string, attemptId: string): Promise<RunState | null> {
    const metrics = await this.readAttemptArtifact<RunMetrics>(runId, attemptId, "metrics.json");
    const events = await this.loadAttemptEvents(runId, attemptId);
    const manifest = await this.readAttemptManifest(resolve(this.attemptDir(runId, attemptId), "attempt.json"));
    const currentState = await this.loadRun(runId);

    if (!metrics && !manifest && !currentState) {
      return null;
    }

    const status = metrics?.status
      ?? manifest?.sourceStatus
      ?? currentState?.status
      ?? "failed";
    const currentPhase = status === "completed"
      ? "complete"
      : manifest?.sourcePhase
        ?? events.at(-1)?.phase
        ?? currentState?.currentPhase
        ?? "intake";

    return {
      runId,
      goal: metrics?.goal ?? currentState?.goal ?? "",
      status,
      approved: false,
      currentPhase,
      phasesCompleted: deriveCompletedPhases(events, status, currentPhase),
      retryCount: metrics?.retryCount ?? currentState?.retryCount ?? 0,
      maxRetries: currentState?.maxRetries ?? 0,
      startedAt: metrics?.startedAt ?? manifest?.sourceStartedAt ?? currentState?.startedAt ?? new Date(0).toISOString(),
      completedAt: metrics?.completedAt ?? manifest?.sourceCompletedAt ?? currentState?.completedAt ?? null,
      finalOutput: null,
      error: manifest?.sourceError ?? currentState?.error ?? null
    };
  }
}

async function walkArtifacts(root: string, current: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.includes(".tmp-")) {
      continue;
    }
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".history") {
        continue;
      }
      files.push(...await walkArtifacts(root, absolute));
      continue;
    }
    if (entry.isFile()) {
      files.push(relative(root, absolute));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content);
  await rename(tempPath, path);
}

function deriveCompletedPhases(
  events: RunEvent[],
  status: RunState["status"],
  currentPhase: Phase
): Phase[] {
  if (status === "completed") {
    return [...PHASES];
  }

  const seen = new Set<Phase>();
  for (const event of events) {
    seen.add(event.phase);
  }
  seen.add(currentPhase);

  return PHASES.filter((phase) => seen.has(phase));
}
