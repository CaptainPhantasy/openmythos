import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Phase } from "../core/types.js";
import type { RunEvent, RunState } from "./types.js";

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
    await writeFile(resolve(this.runDir(state.runId), "state.json"), JSON.stringify(state, null, 2));
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
    state.status = "running";
    state.approved = false;
    state.currentPhase = "intake";
    state.phasesCompleted = [];
    state.error = null;
    state.approved = false;
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
    const path = resolve(this.runDir(runId), "events.jsonl");
    if (!existsSync(path)) {
      return [];
    }
    const text = await readFile(path, "utf8");
    return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunEvent);
  }

  async writeArtifact(runId: string, name: string, value: unknown): Promise<string> {
    const path = resolve(this.runDir(runId), name);
    const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    await writeFile(path, content);
    return path;
  }

  async readArtifact<T>(runId: string, name: string): Promise<T | null> {
    const path = resolve(this.runDir(runId), name);
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(await readFile(path, "utf8")) as T;
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
      const state = await this.loadRun(entry.name);
      if (state) {
        states.push(state);
      }
    }
    return states.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listArtifacts(runId: string): Promise<string[]> {
    const root = this.runDir(runId);
    if (!existsSync(root)) {
      return [];
    }
    return walkArtifacts(root, root);
  }

  private async mustLoad(runId: string): Promise<RunState> {
    const state = await this.loadRun(runId);
    if (!state) {
      throw new Error(`Run not found: ${runId}`);
    }
    return state;
  }
}

async function walkArtifacts(root: string, current: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkArtifacts(root, absolute));
      continue;
    }
    if (entry.isFile()) {
      files.push(relative(root, absolute));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}
