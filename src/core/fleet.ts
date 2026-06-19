// src/core/fleet.ts
// Employee fleet registry — the code-side source of {temperature, role, model} per hire.
// "Code owns the loop": the orchestrator (loop.ts / verification.ts) selects an employee
// from this registry for every hire; the LLM never chooses its own temperature, model, or
// role. The "rotating lineup at different temps" is this registry, selected by code.

import { DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_ID } from "./omp-client.js";

export type EmployeeRole = "worker" | "watcher";

export interface EmployeeConfig {
  role: EmployeeRole;
  /** Chosen by code, never by the model. */
  temperature: number;
  modelProvider: string;
  modelId: string;
}

/** Worker temperature schedule by replacement tier (0, 1, 2+). Literal values avoid float drift. */
const WORKER_TEMPS = [0.3, 0.1, 0.0] as const;
/** Adversarial judgment is deterministic-minded → always 0. */
const WATCHER_TEMP = 0.0;

/**
 * Select a fleet employee for a role at a given tier.
 * - worker: temperature descends 0.3 → 0.1 → 0.0 as the orchestrator fires and rehires;
 *   tiers at or beyond the schedule clamp to the final value (0.0). Negative tiers clamp to 0.
 * - watcher: temperature is always 0.0 regardless of tier.
 * Unknown role throws.
 */
export function pickEmployee(role: EmployeeRole, tier: number): EmployeeConfig {
  if (role === "worker") {
    const idx = Math.min(Math.max(0, tier), WORKER_TEMPS.length - 1);
    return {
      role,
      temperature: WORKER_TEMPS[idx]!,
      modelProvider: DEFAULT_MODEL_PROVIDER,
      modelId: DEFAULT_MODEL_ID,
    };
  }
  if (role === "watcher") {
    return {
      role,
      temperature: WATCHER_TEMP,
      modelProvider: DEFAULT_MODEL_PROVIDER,
      modelId: DEFAULT_MODEL_ID,
    };
  }
  throw new Error(`Unknown employee role: ${String(role)}`);
}

/**
 * Ad-hoc hire: synthesize a one-off employee config when no fleet cell fits.
 * Temperature is clamped to >= 0; provider/model fall back to the fleet defaults.
 * Unknown role throws.
 */
export function buildCustomEmployee(
  role: EmployeeRole,
  temperature: number,
  opts?: { modelProvider?: string; modelId?: string },
): EmployeeConfig {
  if (role !== "worker" && role !== "watcher") {
    throw new Error(`Unknown employee role: ${String(role)}`);
  }
  return {
    role,
    temperature: Math.max(0, temperature),
    modelProvider: opts?.modelProvider ?? DEFAULT_MODEL_PROVIDER,
    modelId: opts?.modelId ?? DEFAULT_MODEL_ID,
  };
}
