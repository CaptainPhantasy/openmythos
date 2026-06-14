import type { Phase } from "../core/types.js";

export interface RunState {
  runId: string;
  goal: string;
  status: "running" | "awaiting_approval" | "completed" | "failed";
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

export interface ModelUsageMetric {
  role: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface RunMetrics {
  runId: string;
  goal: string;
  status: RunState["status"];
  startedAt: string;
  completedAt: string | null;
  totalDurationMs: number;
  retryCount: number;
  phaseCount: number;
  contextFileCount: number;
  taskCount: number;
  modelTaskCount: number;
  harnessTaskCount: number;
  modelToolTurnCount: number;
  modelToolCallCount: number;
  fileEditCount: number;
  patchEditCount: number;
  deleteEditCount: number;
  highRiskReviewCount: number;
  blockingReviewCount: number;
  localVerificationCount: number;
  localVerificationFailureCount: number;
  taskVerificationCount: number;
  taskVerificationFailureCount: number;
  qaPassed: boolean | null;
  qaScore: number | null;
  modelUsage: ModelUsageMetric[];
}
