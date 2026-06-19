// src/core/loop.ts
// The OpenMythos execution loop. Code owns the loop; LLMs are employees.
//
// For each step:
//   1. Dispatch a worker (omp --mode rpc) at task-appropriate temperature
//   2. Run the 3-tier verification gate (deterministic → concrete → judgment)
//   3. On reject: in-place retry with feedback (worker keeps context) up to N redirects
//   4. On exhaustion: KILL worker, rollback to last checkpoint, spawn FRESH worker at lower temp
//   5. On pass: create checkpoint, terminate worker+watcher, advance
//   6. On full exhaustion (retries + replacements): notify-and-park

import { runOmpTurn } from "./omp-client.js";
import { pickEmployee } from "./fleet.js";
import { verifyStep, type StepSpec, type VerificationOutcome } from "./verification.js";
import { createCheckpoint, rollbackTo, commitAll, ensureGitRepo, type Checkpoint } from "./checkpoint.js";
import { notifyAndPark, loadMonitor, type ParkOutcome } from "./notify-park.js";

export interface LoopOptions {
  workdir: string;
  projectName: string;
  /** In-place retries before kill. */
  maxRedirects?: number;
  /** Worker replacements before notify-and-park. */
  maxReplacements?: number;
  /** Where to write STOPPAGE.md on park. */
  parkDir?: string;
}

export interface StepOutcome {
  stepId: string;
  status: "verified" | "parked";
  attempts: number;
  replacements: number;
  finalVerification?: VerificationOutcome;
  park?: ParkOutcome;
  tokensIn: number;
  tokensOut: number;
  durationSec: number;
}

export interface LoopResult {
  projectName: string;
  status: "all_verified" | "parked";
  steps: StepOutcome[];
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationSec: number;
}

const DEFAULT_REDIRECTS = 3;
const DEFAULT_REPLACEMENTS = 3;

/**
 * Run one step under the full worker/watcher/replace discipline.
 * Returns when the step is verified OR parked (notify-and-park fired).
 */
export async function runStep(
  spec: StepSpec,
  opts: Required<Omit<LoopOptions, "workdir" | "projectName">>,
  workdir: string,
  lastCheckpoint: Checkpoint | null
): Promise<StepOutcome> {
  const maxRedirects = opts.maxRedirects;
  const maxReplacements = opts.maxReplacements;
  let tokensIn = 0, tokensOut = 0;
  const start = Date.now();
  let replacements = 0;
  let feedback = "";

  while (true) {
    // Inner redirect loop (worker keeps context within this loop).
    for (let attempt = 1; attempt <= maxRedirects + 1; attempt++) {
      const employee = pickEmployee("worker", replacements);
      const prompt = feedback
        ? `${buildStepPrompt(spec)}\n\nA reviewer rejected your previous attempt: ${feedback}. Re-do, providing real evidence for every criterion.`
        : buildStepPrompt(spec);

      process.stderr.write(`[step:${spec.id}] attempt ${attempt}/${maxRedirects + 1} replacement #${replacements} temp ${employee.temperature}\n`);
      const turn = await runOmpTurn({
        prompt, workdir, tag: `worker_r${replacements}#${attempt}`,
        temperature: employee.temperature,
        modelProvider: employee.modelProvider,
        modelId: employee.modelId,
        employeeRole: employee.role,
      });
      tokensIn += turn.tokensIn; tokensOut += turn.tokensOut;

      const verification = await verifyStep(spec, workdir, workdir);
      if (verification.judgmentTurn) {
        tokensIn += verification.judgmentTurn.tokensIn;
        tokensOut += verification.judgmentTurn.tokensOut;
      }

      process.stderr.write(`[step:${spec.id}] verification ${verification.passed ? "PASS" : "REJECT"} gates: ${verification.gates.map((g) => `${g.tier}:${g.name}=${g.status}`).join(", ")}\n`);

      if (verification.passed) {
        return {
          stepId: spec.id, status: "verified",
          attempts: attempt, replacements,
          finalVerification: verification,
          tokensIn, tokensOut,
          durationSec: Math.round((Date.now() - start) / 100) / 10,
        };
      }

      feedback = synthesizeFeedback(verification);
    }

    // Exhausted redirects → kill + replace (cold context, rollback, lower temp).
    replacements++;
    process.stderr.write(`[step:${spec.id}] exhausted redirects → kill+replace #${replacements} (rollback to checkpoint)\n`);
    if (lastCheckpoint) {
      await rollbackTo(workdir, lastCheckpoint);
    } else {
      // No prior checkpoint: hard reset to baseline HEAD.
      const { executeCommand } = await import("../tools/shell.js");
      await executeCommand("git", ["reset", "--hard", "HEAD"], workdir, 30_000);
      await executeCommand("git", ["clean", "-fdq"], workdir, 30_000);
    }
    feedback = ""; // fresh worker: no memory of prior worker

    if (replacements > maxReplacements) {
      // Full exhaustion → notify-and-park.
      const park = await notifyAndPark({
        projectName: opts.parkDir.split("/").pop() ?? "openmythos",
        stepId: spec.id,
        stepTitle: spec.title,
        attemptsUsed: maxRedirects + 1,
        replacementsUsed: replacements - 1,
        lastFeedback: feedback || "no specific feedback (deterministic/concrete gate failure)",
        parkDir: opts.parkDir,
      });
      // Load the launchd monitor so STOPPAGE.md edits are detected automatically.
      if (park.monitorPlistPath) {
        const loaded = await loadMonitor(park.monitorPlistPath);
        if (!loaded) {
          process.stderr.write(`[step:${spec.id}] WARNING: launchd monitor failed to load (${park.monitorPlistPath}). Manual resume required.\n`);
        } else {
          process.stderr.write(`[step:${spec.id}] launchd monitor loaded. Edit STOPPAGE.md to resume.\n`);
        }
      }
      return {
        stepId: spec.id, status: "parked",
        attempts: maxRedirects + 1, replacements: replacements - 1,
        park,
        tokensIn, tokensOut,
        durationSec: Math.round((Date.now() - start) / 100) / 10,
      };
    }
  }
}

function buildStepPrompt(spec: StepSpec): string {
  const checks = [
    ...spec.verificationCommands,
    ...(spec.concreteChecks ?? []).map((c) => c.command),
  ].map((c) => `  - ${c}`).join("\n");
  return `You are a bounded worker. Complete ONE step. Do not steer the project.

STEP ID: ${spec.id}
TITLE: ${spec.title}
DESCRIPTION: ${spec.description}

These verification commands will run after your work; they must ALL pass:
${checks}

Do the work in the current repo. Use real tools (edit, bash). Do not modify tests to force a pass. Provide real evidence.`;
}

function synthesizeFeedback(v: VerificationOutcome): string {
  const rejected = v.gates.filter((g) => g.status === "reject");
  if (rejected.length === 0) return "rejected by watcher judgment";
  return rejected.map((g) => `[${g.tier}:${g.name}] ${g.output.slice(0, 200)}`).join(" | ");
}

/**
 * Top-level: run an ordered sequence of steps to verified completion.
 * No step starts until the prior is verified. Checkpoints gate progression.
 */
export async function runLoop(steps: StepSpec[], options: LoopOptions): Promise<LoopResult> {
  const opts: Required<Omit<LoopOptions, "workdir" | "projectName">> = {
    maxRedirects: options.maxRedirects ?? DEFAULT_REDIRECTS,
    maxReplacements: options.maxReplacements ?? DEFAULT_REPLACEMENTS,
    parkDir: options.parkDir ?? defaultParkDir(options.projectName),
  };

  await ensureGitRepo(options.workdir);
  // Initial baseline commit (so rollback-to-baseline works for step 1).
  await commitAll(options.workdir, "openmythos: baseline");

  const stepOutcomes: StepOutcome[] = [];
  let lastCheckpoint: Checkpoint | null = null;
  let totalTokensIn = 0, totalTokensOut = 0;
  const start = Date.now();

  for (const spec of steps) {
    const outcome = await runStep(spec, opts, options.workdir, lastCheckpoint);
    stepOutcomes.push(outcome);
    totalTokensIn += outcome.tokensIn;
    totalTokensOut += outcome.tokensOut;

    if (outcome.status === "parked") {
      return finalize(steps, stepOutcomes, options, totalTokensIn, totalTokensOut, start, "parked");
    }

    // Verified → checkpoint + advance.
    await commitAll(options.workdir, `openmythos: verified step ${spec.id}`);
    lastCheckpoint = await createCheckpoint(options.workdir, spec.id);
  }

  return finalize(steps, stepOutcomes, options, totalTokensIn, totalTokensOut, start, "all_verified");
}

function finalize(
  steps: StepSpec[],
  outcomes: StepOutcome[],
  options: LoopOptions,
  tokIn: number, tokOut: number, start: number,
  status: "all_verified" | "parked"
): LoopResult {
  void steps;
  return {
    projectName: options.projectName,
    status,
    steps: outcomes,
    totalTokensIn: tokIn,
    totalTokensOut: tokOut,
    totalDurationSec: Math.round((Date.now() - start) / 100) / 10,
  };
}

function defaultParkDir(projectName: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = "/Users/douglastalley/Library/Mobile Documents/com~apple~CloudDocs/Floyd Docs/BUILD STOPPAGE";
  return `${base}/${projectName}_${ts}`;
}
