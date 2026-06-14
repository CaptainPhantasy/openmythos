import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenMythosConfig } from "../config/schema.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { StateStore } from "../state/store.js";
import { buildFinalReport } from "./report.js";
import { PhaseExecutor } from "./phases.js";
import { evaluateGovernance, GovernanceViolationError } from "./governance.js";
import { ApprovalRequiredError } from "./review.js";
import { buildRunMetrics } from "./metrics.js";
import type { ContextResult, IntakeResult, IssueContext, Plan, QaResult, TaskOutput } from "./types.js";

export interface RunResult {
  runId: string;
  status: "completed" | "failed" | "awaiting_approval";
  finalOutput: string | null;
  artifacts: string[];
}

export class Runner {
  constructor(
    private readonly config: OpenMythosConfig,
    private readonly store: StateStore,
    private readonly workdir: string
  ) {}

  async run(goal: string): Promise<RunResult> {
    const governance = await evaluateGovernance(this.config, this.workdir);
    const runId = randomUUID();
    await this.store.createRun(runId, goal, this.config.execution.maxRetries);
    return this.executeFrom(runId, goal, governance);
  }

  async runFromIssue(issue: IssueContext, goal: string): Promise<RunResult> {
    const governance = await evaluateGovernance(this.config, this.workdir);
    const runId = randomUUID();
    await this.store.createRun(runId, goal, this.config.execution.maxRetries);
    await this.store.writeArtifact(runId, "issue.json", issue);
    return this.executeFrom(runId, goal, governance);
  }

  async resume(runId: string): Promise<RunResult> {
    const state = await this.store.loadRun(runId);
    if (!state) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (state.status === "completed") {
      return {
        runId,
        status: "completed",
        finalOutput: state.finalOutput,
        artifacts: await this.artifacts(runId)
      };
    }
    if (state.status === "awaiting_approval") {
      await this.store.updatePhase(runId, state.currentPhase);
    }
    return this.executeFrom(runId, state.goal);
  }

  private async executeFrom(
    runId: string,
    goal: string,
    governanceSeed?: Awaited<ReturnType<typeof evaluateGovernance>>
  ): Promise<RunResult> {
    const runDir = this.store.runDir(runId);
    const executor = new PhaseExecutor(this.config, new AdapterRegistry(this.config), this.workdir, runDir);
    const started = Date.now();

    let intake = await this.store.readArtifact<IntakeResult>(runId, "intake.json");
    let context = await this.store.readArtifact<ContextResult>(runId, "context.json");
    let plan = await this.store.readArtifact<Plan>(runId, "plan.json");
    let outputs = await this.store.readArtifact<TaskOutput[]>(runId, "outputs.json");
    let qa = await this.store.readArtifact<QaResult>(runId, "qa.json");
    let governance = await this.store.readArtifact<Awaited<ReturnType<typeof evaluateGovernance>>>(runId, "governance.json");

    try {
      if (!governance) {
        governance = governanceSeed ?? await evaluateGovernance(this.config, this.workdir);
        await this.store.writeArtifact(runId, "governance.json", governance);
        await this.event(
          runId,
          "intake",
          "governance_preflight",
          governance.blocked ? "error" : governance.issues.length > 0 ? "warning" : "success",
          governance.blocked
            ? "Governance preflight blocked the run."
            : governance.issues.length > 0
              ? "Governance preflight found warnings."
              : "Governance preflight passed.",
          ["governance.json"],
          Date.now() - started,
          governance.blocked ? governance.issues.map((issue) => issue.message).join(" ") : undefined
        );
        if (governance.blocked) {
          throw new GovernanceViolationError(governance);
        }
      }

      if (!intake) {
        await this.store.updatePhase(runId, "intake");
        intake = await executor.intake(goal);
        await this.store.writeArtifact(runId, "intake.json", intake);
        await this.event(runId, "intake", "classify", "success", "Task classified", ["intake.json"], Date.now() - started);
      }

      if (!context) {
        await this.store.updatePhase(runId, "context");
        const phaseStarted = Date.now();
        context = await executor.context(intake);
        await this.store.writeArtifact(runId, "context.json", context);
        await this.event(runId, "context", "gather_context", "success", `${context.fileManifest.length} files summarized`, ["context.json"], Date.now() - phaseStarted);
      }

      if (!plan) {
        await this.store.updatePhase(runId, "plan");
        const phaseStarted = Date.now();
        plan = await executor.plan(goal, intake, context);
        await this.store.writeArtifact(runId, "plan.json", plan);
        await this.event(runId, "plan", "generate_plan", "success", `${plan.tasks.length} tasks planned`, ["plan.json"], Date.now() - phaseStarted);
      }

      let retry = (await this.store.loadRun(runId))?.retryCount ?? 0;
      while (retry <= this.config.execution.maxRetries) {
        await this.store.updatePhase(runId, "execute");
        const executeStarted = Date.now();
        outputs = await executor.execute(plan, context);
        await this.store.writeArtifact(runId, "outputs.json", outputs);
        await this.event(runId, "execute", "execute_tasks", "success", `${outputs.length} task outputs applied`, ["outputs.json"], Date.now() - executeStarted);

        await this.store.updatePhase(runId, "verify");
        const verifyStarted = Date.now();
        qa = await executor.verify(goal, plan, outputs);
        await this.store.writeArtifact(runId, "qa.json", qa);
        await this.event(runId, "verify", "verify", qa.passed ? "success" : "warning", `QA passed=${qa.passed} score=${qa.score}`, ["qa.json"], Date.now() - verifyStarted);

        if (qa.passed) {
          break;
        }

        retry += 1;
        if (retry > this.config.execution.maxRetries) {
          const finalOutput = buildFinalReport(goal, plan, outputs, qa);
          await this.store.fail(runId, `QA failed after ${this.config.execution.maxRetries} retries`);
          await this.store.writeArtifact(runId, "final.md", finalOutput);
          await this.writeMetrics(runId, executor, context, plan, outputs, qa);
          return {
            runId,
            status: "failed",
            finalOutput,
            artifacts: await this.artifacts(runId)
          };
        }

        await this.store.incrementRetry(runId);
        const repairStarted = Date.now();
        plan = await executor.plan(goal, intake, context, executor.repairNotes(qa));
        await this.store.writeArtifact(runId, "plan.json", plan);
        await this.event(runId, "plan", "repair_plan", "warning", `Retry ${retry}: replanned from QA issues`, ["plan.json"], Date.now() - repairStarted);
      }

      if (!outputs || !plan) {
        throw new Error("Run ended without plan and outputs");
      }

      const finalOutput = buildFinalReport(goal, plan, outputs, qa ?? null);
      await this.store.writeArtifact(runId, "final.md", finalOutput);
      await this.store.complete(runId, finalOutput);
      await this.writeMetrics(runId, executor, context, plan, outputs, qa);
      return {
        runId,
        status: "completed",
        finalOutput,
        artifacts: await this.artifacts(runId)
      };
    } catch (error) {
      if (error instanceof GovernanceViolationError) {
        await this.store.fail(runId, error.message);
        await this.writeMetrics(runId, executor, context, plan, outputs, qa);
        return {
          runId,
          status: "failed",
          finalOutput: null,
          artifacts: await this.artifacts(runId)
        };
      }
      if (error instanceof ApprovalRequiredError) {
        await this.store.awaitApproval(runId, error.message);
        await this.event(
          runId,
          "execute",
          "approval_required",
          "warning",
          `Approval required for ${error.taskId}`,
          [error.review.reviewPath, error.review.patchPath],
          Date.now() - started,
          error.message
        );
        await this.writeMetrics(runId, executor, context, plan, outputs, qa);
        return {
          runId,
          status: "awaiting_approval",
          finalOutput: null,
          artifacts: await this.artifacts(runId)
        };
      }
      await this.store.fail(runId, (error as Error).message);
      await this.event(runId, (await this.store.loadRun(runId))?.currentPhase ?? "intake", "run_failed", "error", "Run failed", [], Date.now() - started, (error as Error).message);
      await this.writeMetrics(runId, executor, context, plan, outputs, qa);
      throw error;
    }
  }

  private async event(
    runId: string,
    phase: "intake" | "context" | "plan" | "execute" | "verify" | "complete",
    action: string,
    status: "success" | "warning" | "error",
    summary: string,
    artifacts: string[],
    durationMs: number,
    error?: string
  ): Promise<void> {
    await this.store.emit(runId, {
      phase,
      action,
      status,
      summary,
      artifacts,
      nextActions: status === "error" ? ["Inspect events.jsonl and rerun resume after fixing the blocker."] : [],
      durationMs,
      ...(error ? { error } : {})
    });
  }

  private async artifacts(runId: string): Promise<string[]> {
    const root = this.store.runDir(runId);
    const files = [
      "state.json",
      "events.jsonl",
      "intake.json",
      "context.json",
      "plan.json",
      "outputs.json",
      "qa.json",
      "issue.json",
      "governance.json",
      "metrics.json",
      "final.md"
    ].map((file) => resolve(root, file))
      .filter((file) => existsSync(file));

    const { readdir } = await import("node:fs/promises");
    try {
      const reviewFiles = (await readdir(root))
        .filter((entry) => entry.startsWith("review-"))
        .map((entry) => resolve(root, entry));
      return [...files, ...reviewFiles];
    } catch {
      return files;
    }
  }

  private async writeMetrics(
    runId: string,
    executor: PhaseExecutor,
    context: ContextResult | null,
    plan: Plan | null,
    outputs: TaskOutput[] | null,
    qa: QaResult | null
  ): Promise<void> {
    const state = await this.store.loadRun(runId);
    if (!state) {
      return;
    }
    await this.store.writeArtifact(runId, "metrics.json", buildRunMetrics({
      state,
      context,
      plan,
      outputs,
      qa,
      reviews: executor.snapshotReviews(),
      verification: executor.verificationMetrics(),
      modelUsage: executor.snapshotModelUsage()
    }));
  }
}
