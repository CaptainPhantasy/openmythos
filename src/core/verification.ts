// src/core/verification.ts
// 3-tier verification gate (Q1 invariant):
//   1. Deterministic gates first (npm test, tsc, executable checks)
//   2. Concrete criteria second (derived executable checks)
//   3. Adversarial LLM judgment LAST and never alone
// A step passes only if every gate that exists fires. Judgment cannot be the sole basis.

import { executeCommand } from "../tools/shell.js";
import { runOmpTurn, verifyOmpAvailable, type OmpTurnResult } from "./omp-client.js";

export type GateStatus = "pass" | "reject" | "skipped";

export interface GateResult {
  tier: "deterministic" | "concrete" | "judgment";
  name: string;
  status: GateStatus;
  output: string;
  exitCode: number | null;
}

export interface StepSpec {
  id: string;
  title: string;
  description: string;
  /** Deterministic commands (npm test, tsc --noEmit, etc.). Tier 1. */
  verificationCommands: string[];
  /** Concrete executable checks (derived from intake). Tier 2. */
  concreteChecks?: Array<{ name: string; command: string }>;
  /** Whether adversarial judgment applies. Tier 3. */
  judgmentEnabled?: boolean;
}

export interface VerificationOutcome {
  passed: boolean;
  gates: GateResult[];
  judgmentTurn?: OmpTurnResult;
}

function runCmd(cmd: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  // Shell-invoked for arg flexibility (npm test, npx tsc, node test/...).
  return executeCommand("bash", ["-lc", cmd], cwd, 120_000)
    .then((r) => ({ exitCode: r.exitCode, output: (r.stdout + r.stderr).slice(-1200) }))
    .catch((e) => ({ exitCode: 1, output: `[exception] ${String(e)}` }));
}

/**
 * Run all gates for a step. Returns the moment a tier fails (short-circuits).
 * Judgment only runs if tiers 1+2 pass AND judgmentEnabled.
 */
export async function verifyStep(
  spec: StepSpec,
  repoDir: string,
  worktreeForWatcher: string
): Promise<VerificationOutcome> {
  const gates: GateResult[] = [];

  // Tier 1 — deterministic.
  for (const cmd of spec.verificationCommands) {
    const r = await runCmd(cmd, repoDir);
    const status: GateStatus = r.exitCode === 0 ? "pass" : "reject";
    gates.push({ tier: "deterministic", name: cmd, status, output: r.output, exitCode: r.exitCode });
    if (status === "reject") {
      return { passed: false, gates };
    }
  }

  // Tier 2 — concrete derived checks.
  for (const check of spec.concreteChecks ?? []) {
    const r = await runCmd(check.command, repoDir);
    const status: GateStatus = r.exitCode === 0 ? "pass" : "reject";
    gates.push({ tier: "concrete", name: check.name, status, output: r.output, exitCode: r.exitCode });
    if (status === "reject") {
      return { passed: false, gates };
    }
  }

  // Tier 3 — adversarial judgment. Never alone.
  if (spec.judgmentEnabled) {
    if (!verifyOmpAvailable()) {
      gates.push({ tier: "judgment", name: "watcher", status: "skipped", output: "omp binary unavailable", exitCode: null });
      return { passed: true, gates };
    }
    const judgment = await runWatcher(spec, repoDir, worktreeForWatcher);
    gates.push({
      tier: "judgment",
      name: "watcher",
      status: judgment.verdict === "pass" ? "pass" : "reject",
      output: judgment.defects.join("; ") || judgment.text.slice(-600),
      exitCode: null,
    });
    return { passed: judgment.verdict === "pass", gates, judgmentTurn: judgment.turn };
  }

  return { passed: true, gates };
}

const WATCHER_PROMPT_TMPL = `You are a strict adversarial reviewer verifying a developer's work on a single step.

STEP ID: {stepId}
STEP TITLE: {title}
STEP DESCRIPTION: {description}

The deterministic and concrete checks already PASSED. Your job is judgment: does the work correctly address the step's root intent, follow best practices, and avoid hand-waving? You may inspect the repo state (use read/search tools). Respond with ONLY a JSON object:
{{"verdict":"pass"|"reject","defects":["..."]}}

Reject if: work patches the symptom, leaves TODOs, modifies tests to force pass, or contains sub-best-practice code. Otherwise pass.`;

async function runWatcher(
  spec: StepSpec,
  repoDir: string,
  worktreeForWatcher: string
): Promise<{ verdict: "pass" | "reject"; defects: string[]; turn: OmpTurnResult; text: string }> {
  const prompt = WATCHER_PROMPT_TMPL
    .replace("{stepId}", spec.id)
    .replace("{title}", spec.title)
    .replace("{description}", spec.description);
  const turn = await runOmpTurn({
    prompt,
    workdir: repoDir,
    tag: `watcher:${spec.id}`,
  });
  const text = turn.text;
  let verdict: "pass" | "reject" = "reject";
  let defects: string[] = [];
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { verdict?: string; defects?: string[] };
      verdict = o.verdict === "pass" ? "pass" : "reject";
      defects = Array.isArray(o.defects) ? o.defects : [];
    } catch {
      verdict = "reject";
    }
  }
  void worktreeForWatcher;
  return { verdict, defects, turn, text };
}
