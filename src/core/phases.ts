import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import type { ZodType } from "zod";
import { readRelativeFile } from "../tools/files.js";
import type { OpenMythosConfig } from "../config/schema.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import { gatherContext } from "../context/gather.js";
import {
  CODER_SYSTEM,
  COMPRESSOR_SYSTEM,
  CRITIC_SYSTEM,
  INTAKE_SYSTEM,
  PLANNER_SYSTEM,
  TASK_VERIFIER_SYSTEM,
  VERIFIER_SYSTEM
} from "../prompts/contracts.js";
import { applyFileEdits } from "../tools/files.js";
import { executeShell, type ShellResult } from "../tools/shell.js";
import { parseJsonFromModel } from "./json.js";
import { ApprovalRequiredError, createReviewBundle } from "./review.js";
import { contextSchema, intakeSchema, planSchema, qaSchema, taskOutputSchema } from "./schemas.js";
import { formatToolCatalogForPrompt, normalizePlanTools, summarizeToolValidationIssues } from "./tooling.js";
import { buildExecutionBatches } from "./toposort.js";
import type { AdapterRequest, CommandReceipt, ContextResult, IntakeResult, Plan, PlanTask, QaResult, ReviewBundle, TaskExecutionReceipt, TaskOutput } from "./types.js";
import type { ModelUsageMetric } from "../state/types.js";

export class PhaseExecutor {
  private readonly modelUsage = new Map<string, ModelUsageMetric>();
  private readonly reviews: ReviewBundle[] = [];
  private lastVerificationSummary = {
    localVerificationCount: 0,
    localVerificationFailureCount: 0,
    taskVerificationCount: 0,
    taskVerificationFailureCount: 0
  };
  private taskReceipts: TaskExecutionReceipt[] = [];

  constructor(
    private readonly config: OpenMythosConfig,
    private readonly adapters: AdapterRegistry,
    private readonly workdir: string,
    private readonly runDir: string
  ) {}

  async intake(goal: string): Promise<IntakeResult> {
    const model = this.config.models.planner;
    return await this.callJson("planner", "intake", {
      system: INTAKE_SYSTEM,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      json: true,
      messages: [{
        role: "user",
        content: `Classify this task for execution.\n\nGoal:\n${goal}`
      }]
    }, intakeSchema) as IntakeResult;
  }

  async context(intake: IntakeResult): Promise<ContextResult> {
    const query = [intake.description, ...intake.successCriteria].join("\n");
    const raw = await gatherContext(this.workdir, this.config.context, intake.relevantPatterns, query);
    const filesText = Object.entries(raw.files)
      .map(([path, content]) => `=== ${path} ===\n${content}`)
      .join("\n\n");
    const model = this.config.models.compressor;
    const parsed = await this.callJson("compressor", "context", {
      system: COMPRESSOR_SYSTEM,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      json: true,
      messages: [{
        role: "user",
        content: `Task:\n${intake.description}\n\nFile manifest:\n${raw.manifest.join("\n")}\n\nFiles:\n${filesText}`
      }]
    }, contextSchema) as ContextResult;
    return {
      ...parsed,
      fileManifest: raw.manifest
    };
  }

  async plan(goal: string, intake: IntakeResult, context: ContextResult, repairNotes = ""): Promise<Plan> {
    const snippets = Object.entries(context.relevantSnippets)
      .map(([path, content]) => `=== ${path} ===\n${content}`)
      .join("\n\n");
    const model = this.config.models.planner;
    const buildPlanRequest = (extraNotes = "") => ({
      system: PLANNER_SYSTEM,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      json: true as const,
      messages: [{
        role: "user" as const,
        content: `Goal:\n${goal}\n\nTask type: ${intake.taskType}\n\nSuccess criteria:\n${intake.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n\nContext summary:\n${context.summary}\n\nRelevant snippets:\n${snippets}\n\nAvailable harness tools:\n${formatToolCatalogForPrompt()}\n\n${repairNotes ? `Repair notes from failed verification:\n${repairNotes}\n\n` : ""}${extraNotes}`
      }]
    });

    let planned = await this.callJson("planner", "plan", buildPlanRequest(), planSchema) as Plan;
    let normalized = normalizePlanTools(planned);
    if (normalized.issues.length === 0) {
      return normalized.plan;
    }

    const toolRepairNotes = summarizeToolValidationIssues(normalized.issues);
    planned = await this.callJson("planner", "plan", buildPlanRequest(`Tooling corrections required:\n${toolRepairNotes}\nUse only supported tool ids, and make them compatible with the task role.`), planSchema) as Plan;
    normalized = normalizePlanTools(planned);
    if (normalized.issues.length > 0) {
      throw new Error(`Plan referenced unsupported or mismatched tools after repair:\n${summarizeToolValidationIssues(normalized.issues)}`);
    }

    return normalized.plan;
  }

  async execute(plan: Plan, context: ContextResult): Promise<TaskOutput[]> {
    const outputs: TaskOutput[] = [];
    this.taskReceipts = [];
    const batches = buildExecutionBatches(plan.tasks, plan.dependencies);
    const snippets = Object.entries(context.relevantSnippets)
      .map(([path, content]) => `=== ${path} ===\n${content}`)
      .join("\n\n");

    for (const batch of batches) {
      const batchOutputs = await Promise.all(batch.map(async (task) => {
        const output = await this.executeTask(task, plan, snippets, outputs);
        const review = await createReviewBundle(
          this.workdir,
          this.runDir,
          task.id,
          output.fileEdits,
          this.config.approval
        );
        return { task, output, review };
      }));

      for (const item of batchOutputs) {
        this.reviews.push(item.review);
        if (item.review.blocking) {
          throw new ApprovalRequiredError(item.task.id, item.review);
        }
      }

      for (const item of batchOutputs) {
        await applyFileEdits(this.workdir, item.output.fileEdits, this.runDir);
        this.taskReceipts.push(await this.buildTaskReceipt(item.task, item.output, item.review, item.task.role));
        outputs.push(item.output);
      }
    }

    return outputs;
  }

  async verify(goal: string, plan: Plan, outputs: TaskOutput[]): Promise<QaResult> {
    const localResults: ShellResult[] = [];
    for (const command of this.config.verification.localCommands) {
      localResults.push(await executeShell(command, this.workdir, this.config.execution.timeoutMs));
    }

    const taskVerificationResults = this.taskReceipts.flatMap((receipt) =>
      receipt.verificationResults.map((result) => ({
        taskId: receipt.taskId,
        result
      }))
    );
    const taskVerificationFailures = taskVerificationResults.filter((entry) => entry.result.exitCode !== 0);

    this.lastVerificationSummary = {
      localVerificationCount: localResults.length,
      localVerificationFailureCount: localResults.filter((result) => result.exitCode !== 0).length,
      taskVerificationCount: taskVerificationResults.length,
      taskVerificationFailureCount: taskVerificationFailures.length
    };

    const localFailures = localResults.filter((result) => result.exitCode !== 0);
    if (this.config.verification.requireLocalPassBeforeModelQa && (localFailures.length > 0 || taskVerificationFailures.length > 0)) {
      return {
        passed: false,
        score: 0,
        issues: [
          ...localFailures.map((result) => ({
            severity: "critical" as const,
            description: `Local command failed: ${result.command}\nstdout:\n${result.stdout.slice(-2000)}\nstderr:\n${result.stderr.slice(-2000)}`
          })),
          ...taskVerificationFailures.map((entry) => ({
            severity: "critical" as const,
            description: `Task verification failed for ${entry.taskId}: ${entry.result.command}\nstdout:\n${entry.result.stdout.slice(-2000)}\nstderr:\n${entry.result.stderr.slice(-2000)}`
          }))
        ],
        suggestions: ["Fix failing local or task-level verification commands before model QA."],
        verifiedCriteria: [],
        failedCriteria: plan.successCriteria
      };
    }

    const changedFiles = [...new Set(outputs.flatMap((output) => output.fileEdits)
      .filter((edit) => edit.action !== "delete")
      .map((edit) => edit.path))];
    const fileState: Record<string, string> = {};
    for (const file of changedFiles) {
      try {
        fileState[file] = await readRelativeFile(this.workdir, file);
      } catch (error) {
        fileState[file] = `[read failed: ${(error as Error).message}]`;
      }
    }

    const model = this.config.models.verifier;
    return await this.callJson("verifier", "verify", {
      system: VERIFIER_SYSTEM,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      json: true,
      messages: [{
        role: "user",
        content: `Goal:\n${goal}\n\nSuccess criteria:\n${plan.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n\nTask outputs:\n${JSON.stringify(outputs, null, 2)}\n\nTask execution receipts:\n${JSON.stringify(this.taskReceipts, null, 2)}\n\nLocal verification:\n${JSON.stringify(localResults, null, 2)}\n\nCurrent changed file contents:\n${JSON.stringify(fileState, null, 2)}`
      }]
    }, qaSchema) as QaResult;
  }

  repairNotes(qa: QaResult): string {
    return qa.issues
      .map((issue) => `[${issue.severity}] ${issue.file ? `${issue.file}: ` : ""}${issue.description}${issue.suggestedFix ? `\nSuggested fix: ${issue.suggestedFix}` : ""}`)
      .join("\n\n");
  }

  snapshotModelUsage(): ModelUsageMetric[] {
    return [...this.modelUsage.values()].sort((a, b) => a.role.localeCompare(b.role));
  }

  verificationMetrics(): { localVerificationCount: number; localVerificationFailureCount: number; taskVerificationCount: number; taskVerificationFailureCount: number } {
    return { ...this.lastVerificationSummary };
  }

  snapshotReviews(): ReviewBundle[] {
    return [...this.reviews];
  }

  snapshotTaskReceipts(): TaskExecutionReceipt[] {
    return [...this.taskReceipts];
  }

  private async callJson<T>(
    role: "planner" | "compressor" | "coder" | "critic" | "verifier",
    label: string,
    request: AdapterRequest,
    schema: ZodType<T>
  ): Promise<T> {
    let lastError: Error | null = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.adapters.call(role, attempt === 1
        ? request
        : {
            ...request,
            messages: [
              ...request.messages,
              {
                role: "user",
                content: "The previous response was rejected by the harness because it was not complete valid JSON matching the required schema. Return only one complete valid JSON object now. Do not include markdown or commentary."
              }
            ]
          });

      this.recordModelUsage(role, response.model, response.inputTokens, response.outputTokens, response.durationMs);

      try {
        return schema.parse(parseJsonFromModel(response.content));
      } catch (error) {
        lastError = error as Error;
        const rawPath = resolve(this.runDir, `${label}-invalid-attempt-${attempt}.txt`);
        await writeFile(rawPath, response.content, "utf-8");
      }
    }

    throw new Error(`${lastError?.message ?? "Model output failed validation"}; raw responses saved under ${this.runDir}`);
  }

  private async executeTask(
    task: PlanTask,
    plan: Plan,
    snippets: string,
    priorOutputs: TaskOutput[]
  ): Promise<TaskOutput> {
    const role = task.role;
    const currentFileState: Record<string, string> = {};
    for (const file of task.fileTargets) {
      try {
        currentFileState[file] = await readRelativeFile(this.workdir, file);
      } catch (error) {
        currentFileState[file] = `[read failed: ${(error as Error).message}]`;
      }
    }
    const model = this.config.models[role];
    return await this.callJson(role, `execute-${task.id}`, {
      system: role === "critic"
        ? CRITIC_SYSTEM
        : role === "verifier"
          ? TASK_VERIFIER_SYSTEM
          : CODER_SYSTEM,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      json: true,
      messages: [{
        role: "user",
        content: `Task:\n${JSON.stringify(task, null, 2)}\n\nSuccess criteria:\n${plan.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n\nRelevant snippets:\n${snippets}\n\nCurrent file state:\n${JSON.stringify(currentFileState, null, 2)}\n\nPrior outputs:\n${JSON.stringify(priorOutputs, null, 2)}`
      }]
    }, taskOutputSchema) as TaskOutput;
  }

  private async buildTaskReceipt(
    task: PlanTask,
    output: TaskOutput,
    review: ReviewBundle,
    executorRole: Extract<PlanTask["role"], "coder" | "critic" | "verifier">
  ): Promise<TaskExecutionReceipt> {
    const verificationResults: CommandReceipt[] = [];
    for (const command of task.verificationCommands) {
      const result = await executeShell(command, this.workdir, this.config.execution.timeoutMs);
      verificationResults.push({
        command: result.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs
      });
    }

    const failingResults = verificationResults.filter((result) => result.exitCode !== 0);
    if (failingResults.length > 0) {
      return {
        taskId: task.id,
        executorRole,
        status: "error",
        summary: `Applied edits for ${task.id}, but ${failingResults.length} task verification command(s) failed.`,
        requiredTools: task.requiredTools,
        verificationCommands: task.verificationCommands,
        verificationResults,
        artifacts: [...output.fileEdits.map((edit) => edit.path), review.reviewPath, review.patchPath],
        nextActions: [`Inspect the failing task verification command output for ${task.id}.`]
      };
    }

    if (task.verificationCommands.length === 0) {
      return {
        taskId: task.id,
        executorRole,
        status: "warning",
        summary: `Applied edits for ${task.id}, but no task-level verification commands were provided.`,
        requiredTools: task.requiredTools,
        verificationCommands: [],
        verificationResults: [],
        artifacts: [...output.fileEdits.map((edit) => edit.path), review.reviewPath, review.patchPath],
        nextActions: ["Add verificationCommands to this task for stronger local evidence."]
      };
    }

    return {
      taskId: task.id,
      executorRole,
      status: "success",
      summary: `Applied edits for ${task.id} and passed all task-level verification commands.`,
      requiredTools: task.requiredTools,
      verificationCommands: task.verificationCommands,
      verificationResults,
      artifacts: [...output.fileEdits.map((edit) => edit.path), review.reviewPath, review.patchPath],
      nextActions: []
    };
  }

  private recordModelUsage(
    role: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    durationMs: number
  ): void {
    const key = `${role}:${model}`;
    const existing = this.modelUsage.get(key) ?? {
      role,
      model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0
    };

    existing.calls += 1;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.durationMs += durationMs;
    this.modelUsage.set(key, existing);
  }
}

export function artifactPath(runDir: string, name: string): string {
  return resolve(runDir, name);
}
