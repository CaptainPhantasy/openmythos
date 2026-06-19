import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// Adaptive model selection: track per-(taskType, role) success/failure and
// latency, persist it, and bias routing toward the role that historically
// performs best for a task type. This closes the loop between model-routing's
// static policies and observed real-world outcomes.

export interface ModelPerformance {
  taskType: string;
  role: string;
  successes: number;
  failures: number;
  totalDurationMs: number;
  attempts: number;
}

export interface RoutingStats {
  performance: ModelPerformance[];
  lastUpdated: string;
}

const EMPTY_STATS: RoutingStats = { performance: [], lastUpdated: "" };

function statsPath(workdir: string): string {
  return resolve(workdir, ".openmythos", "routing-stats.json");
}

export async function loadRoutingStats(workdir: string): Promise<RoutingStats> {
  const path = statsPath(workdir);
  if (!existsSync(path)) return { performance: [], lastUpdated: "" };
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    return {
      performance: Array.isArray(data.performance) ? data.performance : [],
      lastUpdated: data.lastUpdated ?? "",
    };
  } catch {
    return { performance: [], lastUpdated: "" };
  }
}

export async function saveRoutingStats(workdir: string, stats: RoutingStats): Promise<void> {
  await mkdir(resolve(workdir, ".openmythos"), { recursive: true });
  stats.lastUpdated = new Date().toISOString();
  await writeFile(statsPath(workdir), JSON.stringify(stats, null, 2), "utf8");
}

function findEntry(stats: RoutingStats, taskType: string, role: string): ModelPerformance | undefined {
  return stats.performance.find((p) => p.taskType === taskType && p.role === role);
}

export async function recordOutcome(
  workdir: string,
  taskType: string,
  role: string,
  success: boolean,
  durationMs: number
): Promise<RoutingStats> {
  const stats = await loadRoutingStats(workdir);
  let entry = findEntry(stats, taskType, role);
  if (!entry) {
    entry = { taskType, role, successes: 0, failures: 0, totalDurationMs: 0, attempts: 0 };
    stats.performance.push(entry);
  }
  entry.attempts += 1;
  entry.totalDurationMs += Math.max(0, durationMs);
  if (success) entry.successes += 1;
  else entry.failures += 1;
  await saveRoutingStats(workdir, stats);
  return stats;
}

export function getSuccessRate(stats: RoutingStats, taskType: string, role: string): number {
  const entry = findEntry(stats, taskType, role);
  if (!entry || entry.attempts === 0) return -1; // unknown
  return entry.successes / entry.attempts;
}

export function getAvgDuration(stats: RoutingStats, taskType: string, role: string): number {
  const entry = findEntry(stats, taskType, role);
  if (!entry || entry.attempts === 0) return -1;
  return entry.totalDurationMs / entry.attempts;
}

export interface AdaptiveDecision {
  role: string;
  reason: string;
  basedOnHistory: boolean;
  successRate: number;
}

/**
 * Pick the best role for a task type from candidates, based on historical
 * success rate. Requires a minimum number of attempts before trusting history;
 * below that it returns the fallback. Ties broken by lower average latency.
 */
export function getAdaptiveRole(
  stats: RoutingStats,
  taskType: string,
  candidateRoles: string[],
  fallback: string,
  minAttempts = 3
): AdaptiveDecision {
  let best: { role: string; rate: number; avgDuration: number } | null = null;

  for (const role of candidateRoles) {
    const entry = findEntry(stats, taskType, role);
    if (!entry || entry.attempts < minAttempts) continue;
    const rate = entry.successes / entry.attempts;
    const avgDuration = entry.totalDurationMs / entry.attempts;
    if (
      !best ||
      rate > best.rate ||
      (rate === best.rate && avgDuration < best.avgDuration)
    ) {
      best = { role, rate, avgDuration };
    }
  }

  if (!best) {
    return {
      role: fallback,
      reason: `No sufficient history (>= ${minAttempts} attempts) for "${taskType}"; using fallback "${fallback}".`,
      basedOnHistory: false,
      successRate: -1,
    };
  }

  return {
    role: best.role,
    reason: `Adaptive: "${best.role}" has ${Math.round(best.rate * 100)}% success rate on "${taskType}" over history.`,
    basedOnHistory: true,
    successRate: best.rate,
  };
}
