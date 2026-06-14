import type { Phase } from "../core/types.js";

export interface RunState {
  runId: string;
  goal: string;
  status: "running" | "completed" | "failed";
  currentPhase: Phase;
  phasesCompleted: Phase[];
  retryCount: number;
  maxRetries: number;
  startedAt: string;
  completedAt: string | null;
  finalOutput: string | null;
  error: string | null;
}

export interface RunEvent {
  timestamp: string;
  phase: Phase;
  action: string;
  status: "success" | "warning" | "error";
  summary: string;
  artifacts: string[];
  nextActions: string[];
  durationMs: number;
  error?: string;
}
