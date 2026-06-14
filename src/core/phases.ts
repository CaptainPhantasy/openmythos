import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import { findSymbolDefinitions, searchRepository } from "../tools/retrieval.js";
import { parseJsonFromModel } from "./json.js";
import { ApprovalRequiredError, createReviewBundle } from "./review.js";
import { contextSchema, intakeSchema, planSchema, qaSchema, taskOutputSchema, taskStepSchema } from "./schemas.js";
import {
  formatHarnessActionCatalogForPrompt,
  formatToolCatalogForPrompt,
  normalizePlanTools,
  summarizeToolValidationIssues
} from "./tooling.js";
import { buildExecutionBatches } from "./toposort.js";
import type { AdapterMessage, AdapterRequest, CommandReceipt, ContextResult, IntakeResult, Plan, PlanTask, QaResult, ReviewBundle, TaskExecutionReceipt, TaskObservation, TaskOutput, TaskStepResult, TaskToolRequest } from "./types.js";
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
        content: `Goal:\n${goal}\n\nTask type: ${intake.taskType}\n\nSuccess criteria:\n${intake.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n\nContext summary:\n${context.summary}\n\nRelevant snippets:\n${snippets}\n\nAvailable harness tools:\n${formatToolCatalogForPrompt()}\n\nAvailable harness actions:\n${formatHarnessActionCatalogForPrompt()}\n\n${repairNotes ? `Repair notes from failed verification:\n${repairNotes}\n\n` : ""}${extraNotes}`
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
        const execution = await this.executeTask(task, plan, snippets, outputs);
        const review = await createReviewBundle(
          this.workdir,
          this.runDir,
          task.id,
          execution.output.fileEdits,
          this.config.approval
        );
        return { task, execution, review };
      }));

      for (const item of batchOutputs) {
        this.reviews.push(item.review);
        if (item.review.blocking) {
          throw new ApprovalRequiredError(item.task.id, item.review);
        }
      }

      for (const item of batchOutputs) {
        await applyFileEdits(this.workdir, item.execution.output.fileEdits, this.runDir);
        this.taskReceipts.push(await this.buildTaskReceipt(
          item.task,
          item.execution.output,
          item.review,
          item.execution.executorKind,
          item.execution.executorRole,
          item.execution.toolTurnCount,
          item.execution.toolCallCount,
          item.execution.observations,
          item.execution.artifacts,
          item.execution.verificationResults
        ));
        outputs.push(item.execution.output);
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
  ): Promise<{
    output: TaskOutput;
    executorKind: PlanTask["executor"];
    executorRole: Extract<PlanTask["role"], "coder" | "critic" | "verifier">;
    toolTurnCount: number;
    toolCallCount: number;
    observations: TaskObservation[];
    artifacts: string[];
    verificationResults?: CommandReceipt[];
  }> {
    if (task.executor === "harness") {
      return this.executeHarnessTask(task);
    }

    const dependencyContext = this.buildDependencyContext(task, plan, priorOutputs, this.taskReceipts);
    const taskContextArtifacts: string[] = [];
    if (dependencyContext.outputs.length > 0 || dependencyContext.receipts.length > 0) {
      const artifactPath = resolve(this.runDir, `task-dependencies-${task.id}.json`);
      await writeFile(
        artifactPath,
        JSON.stringify({ taskId: task.id, dependencies: dependencyContext }, null, 2),
        "utf-8"
      );
      taskContextArtifacts.push(artifactPath);
    }

    const taskContextObservations = await this.collectModelTaskContext(task);
    if (taskContextObservations.length > 0) {
      const artifactPath = resolve(this.runDir, `task-context-${task.id}.json`);
      await writeFile(
        artifactPath,
        JSON.stringify({ taskId: task.id, observations: taskContextObservations }, null, 2),
        "utf-8"
      );
      taskContextArtifacts.push(artifactPath);
    }

    const loopResult = await this.executeModelTaskLoop(task, plan, snippets, dependencyContext, taskContextObservations);
    if (loopResult.artifactPath) {
      taskContextArtifacts.push(loopResult.artifactPath);
    }

    return {
      output: loopResult.output,
      executorKind: "model",
      executorRole: task.role,
      toolTurnCount: loopResult.toolTurnCount,
      toolCallCount: loopResult.toolCallCount,
      observations: [...taskContextObservations, ...loopResult.toolObservations],
      artifacts: taskContextArtifacts
    };
  }

  private async executeHarnessTask(
  task: PlanTask
  ): Promise<{
    output: TaskOutput;
    executorKind: "harness";
    executorRole: "verifier";
    toolTurnCount: number;
    toolCallCount: number;
    observations: TaskObservation[];
    artifacts: string[];
    verificationResults: CommandReceipt[];
  }> {
    const observations = await this.collectHarnessObservations(task);
    const observationArtifactPath = resolve(this.runDir, `task-observation-${task.id}.json`);
    await writeFile(
      observationArtifactPath,
      JSON.stringify({ taskId: task.id, observations }, null, 2),
      "utf-8"
    );
    const verificationResults = await this.runVerificationCommands(task.verificationCommands);
    const failures = verificationResults.filter((result) => result.exitCode !== 0);

    return {
      output: {
        taskId: task.id,
        status: failures.length === 0 ? "success" : "failed",
        fileEdits: [],
        summary: failures.length === 0
          ? `Harness executed ${verificationResults.length} deterministic verification command(s) for ${task.id}.`
          : `Harness execution found ${failures.length} failing verification command(s) for ${task.id}.`,
        errors: failures.map((result) => `Verification command failed: ${result.command}`)
      },
      executorKind: "harness",
      executorRole: "verifier",
      toolTurnCount: 0,
      toolCallCount: 0,
      observations,
      artifacts: [observationArtifactPath],
      verificationResults
    };
  }

  private async buildTaskReceipt(
    task: PlanTask,
    output: TaskOutput,
    review: ReviewBundle,
    executorKind: PlanTask["executor"],
    executorRole: Extract<PlanTask["role"], "coder" | "critic" | "verifier">,
    toolTurnCount: number,
    toolCallCount: number,
    observations: TaskObservation[],
    extraArtifacts: string[],
    precomputedVerificationResults?: CommandReceipt[]
  ): Promise<TaskExecutionReceipt> {
    const verificationResults = precomputedVerificationResults ?? await this.runVerificationCommands(task.verificationCommands);
    const actionSummary = output.fileEdits.length > 0
      ? `Applied edits for ${task.id}`
      : executorKind === "harness"
        ? `Executed harness task ${task.id}`
        : `Executed task ${task.id}`;

    const failingResults = verificationResults.filter((result) => result.exitCode !== 0);
    if (failingResults.length > 0) {
      return {
        taskId: task.id,
        executorKind,
        executorRole,
        harnessAction: task.harnessAction,
        toolTurnCount,
        toolCallCount,
        status: "error",
        summary: `${actionSummary}, but ${failingResults.length} task verification command(s) failed.`,
        requiredTools: task.requiredTools,
        observations,
        verificationCommands: task.verificationCommands,
        verificationResults,
        artifacts: [...output.fileEdits.map((edit) => edit.path), ...extraArtifacts, review.reviewPath, review.patchPath],
        nextActions: [`Inspect the failing task verification command output for ${task.id}.`]
      };
    }

    if (task.verificationCommands.length === 0) {
      return {
        taskId: task.id,
        executorKind,
        executorRole,
        harnessAction: task.harnessAction,
        toolTurnCount,
        toolCallCount,
        status: "warning",
        summary: `${actionSummary}, but no task-level verification commands were provided.`,
        requiredTools: task.requiredTools,
        observations,
        verificationCommands: [],
        verificationResults: [],
        artifacts: [...output.fileEdits.map((edit) => edit.path), ...extraArtifacts, review.reviewPath, review.patchPath],
        nextActions: ["Add verificationCommands to this task for stronger local evidence."]
      };
    }

    return {
      taskId: task.id,
      executorKind,
      executorRole,
      harnessAction: task.harnessAction,
      toolTurnCount,
      toolCallCount,
      status: "success",
      summary: `${actionSummary} and passed all task-level verification commands.`,
      requiredTools: task.requiredTools,
      observations,
      verificationCommands: task.verificationCommands,
      verificationResults,
      artifacts: [...output.fileEdits.map((edit) => edit.path), ...extraArtifacts, review.reviewPath, review.patchPath],
      nextActions: []
    };
  }

  private async collectHarnessObservations(task: PlanTask): Promise<TaskObservation[]> {
    const observations: TaskObservation[] = [];
    switch (task.harnessAction) {
      case "verify.file_state":
        await this.collectFileStateObservations(task, observations);
        break;
      case "verify.git_status": {
        const gitStatus = await this.collectGitStatusObservation();
        if (gitStatus) {
          observations.push(gitStatus);
        }
        break;
      }
      case "verify.git_diff": {
        const gitDiff = await this.collectGitDiffObservation();
        if (gitDiff) {
          observations.push(gitDiff);
        }
        if (task.requiredTools.includes("review.inspect")) {
          observations.push({
            kind: "review.inspect",
            status: "warning",
            summary: "No review artifacts exist before apply.",
            content: "Review artifacts are created after task execution when the harness evaluates proposed file edits.",
            nextActions: ["Inspect execution receipts after apply if you need diff-aware review evidence."],
            artifacts: []
          });
        }
        break;
      }
      case "verify.issue_context": {
        const issueObservation = await this.collectArtifactObservation("issue.context", "issue.json");
        if (issueObservation) {
          observations.push(issueObservation);
        }
        break;
      }
      case "verify.pr_context": {
        const pullRequestObservation = await this.collectArtifactObservation("pull_request.context", "pull-request.json");
        if (pullRequestObservation) {
          observations.push(pullRequestObservation);
        }
        break;
      }
      case "verify.pr_checks": {
        const verificationObservation = await this.collectArtifactObservation("pull_request.verification", "pr-verification.json");
        if (verificationObservation) {
          observations.push(verificationObservation);
        }
        break;
      }
      case null:
        observations.push({
          kind: "harness.action",
          status: "error",
          summary: "Harness task is missing harnessAction.",
          content: "The planner must provide a harnessAction for executor=harness tasks.",
          nextActions: ["Repair the task plan so every harness task declares a supported harnessAction."],
          artifacts: []
        });
        break;
    }

    return observations;
  }

  private async collectFileStateObservations(task: PlanTask, observations: TaskObservation[]): Promise<void> {
    for (const file of task.fileTargets) {
      try {
        const content = await readRelativeFile(this.workdir, file);
        observations.push({
          kind: "filesystem.read",
          status: "success",
          summary: `Read ${file}`,
          content,
          nextActions: [],
          artifacts: [file]
        });
      } catch (error) {
        observations.push({
          kind: "filesystem.read",
          status: "warning",
          summary: `Could not read ${file}`,
          content: `[read failed: ${(error as Error).message}]`,
          nextActions: ["Check whether the file exists and is inside the workdir before retrying."],
          artifacts: [file]
        });
      }
    }
  }

  private async collectModelTaskContext(task: PlanTask): Promise<TaskObservation[]> {
    const observations: TaskObservation[] = [];
    const queries = [...new Set(task.contextQueries.map((query) => query.trim()).filter((query) => query.length > 0))];

    if (task.requiredTools.includes("filesystem.search")) {
      if (queries.length > 0) {
        for (const query of queries) {
          observations.push(await searchRepository(this.workdir, query, this.config.execution.timeoutMs));
        }
      }
    }

    if (task.requiredTools.includes("code.symbols")) {
      if (queries.length > 0) {
        for (const query of queries) {
          observations.push(await findSymbolDefinitions(this.workdir, query, this.config.execution.timeoutMs));
        }
      }
    }

    return observations;
  }

  private async executeModelTaskLoop(
    task: PlanTask,
    plan: Plan,
    snippets: string,
    dependencyContext: { dependencyIds: string[]; outputs: TaskOutput[]; receipts: TaskExecutionReceipt[] },
    taskContextObservations: TaskObservation[]
  ): Promise<{
    output: TaskOutput;
    toolTurnCount: number;
    toolCallCount: number;
    toolObservations: TaskObservation[];
    artifactPath: string | null;
  }> {
    const role = task.role;
    const model = this.config.models[role];
    const currentFileState = await this.readCurrentFileState(task);
    const messages: AdapterMessage[] = [{
      role: "user",
      content: `Task:\n${JSON.stringify(task, null, 2)}\n\nSuccess criteria:\n${plan.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n\nRelevant snippets:\n${snippets}\n\nDeclared dependency ids:\n${JSON.stringify(dependencyContext.dependencyIds, null, 2)}\n\nDependency outputs:\n${JSON.stringify(dependencyContext.outputs, null, 2)}\n\nDependency execution receipts:\n${JSON.stringify(dependencyContext.receipts, null, 2)}\n\nTask tool context:\n${JSON.stringify(taskContextObservations, null, 2)}\n\nCurrent file state:\n${JSON.stringify(currentFileState, null, 2)}`
    }];
    const toolObservations: TaskObservation[] = [];
    const toolTurns: Array<{ turn: number; toolRequests: TaskToolRequest[]; observations: TaskObservation[] }> = [];

    for (let turn = 0; turn <= this.config.execution.maxTaskToolTurns; turn += 1) {
      const step = await this.callJson(role, `execute-${task.id}-turn-${turn}`, {
        system: role === "critic"
          ? CRITIC_SYSTEM
          : role === "verifier"
            ? TASK_VERIFIER_SYSTEM
            : CODER_SYSTEM,
        maxTokens: model.maxTokens,
        temperature: model.temperature,
        json: true,
        messages
      }, taskStepSchema) as TaskStepResult;

      if (step.status !== "tool") {
        return {
          output: {
            taskId: step.taskId,
            status: step.status,
            fileEdits: step.fileEdits,
            summary: step.summary,
            errors: step.errors
          },
          toolTurnCount: toolTurns.length,
          toolCallCount: toolTurns.reduce((sum, item) => sum + item.toolRequests.length, 0),
          toolObservations,
          artifactPath: await this.writeTaskToolTurnsArtifact(task.id, toolTurns)
        };
      }

      if (turn === this.config.execution.maxTaskToolTurns) {
        return {
          output: {
            taskId: task.id,
            status: "failed",
            fileEdits: [],
            summary: `Task ${task.id} exceeded the maximum model tool turns.`,
            errors: [`The model requested more than ${this.config.execution.maxTaskToolTurns} tool turns.`]
          },
          toolTurnCount: toolTurns.length,
          toolCallCount: toolTurns.reduce((sum, item) => sum + item.toolRequests.length, 0),
          toolObservations,
          artifactPath: await this.writeTaskToolTurnsArtifact(task.id, toolTurns)
        };
      }

      const observations = await this.executeModelToolRequests(task, step.toolRequests);
      toolTurns.push({ turn: turn + 1, toolRequests: step.toolRequests, observations });
      toolObservations.push(...observations);
      messages.push({
        role: "assistant",
        content: JSON.stringify(step)
      });
      messages.push({
        role: "user",
        content: `Tool results for the previous request:\n${JSON.stringify(observations, null, 2)}`
      });
    }

    return {
      output: {
        taskId: task.id,
        status: "failed",
        fileEdits: [],
        summary: `Task ${task.id} exited the model tool loop without a final result.`,
        errors: ["The model did not produce a final task result."]
      },
      toolTurnCount: toolTurns.length,
      toolCallCount: toolTurns.reduce((sum, item) => sum + item.toolRequests.length, 0),
      toolObservations,
      artifactPath: await this.writeTaskToolTurnsArtifact(task.id, toolTurns)
    };
  }

  private async readCurrentFileState(task: PlanTask): Promise<Record<string, string>> {
    const currentFileState: Record<string, string> = {};
    for (const file of task.fileTargets) {
      try {
        currentFileState[file] = await readRelativeFile(this.workdir, file);
      } catch (error) {
        currentFileState[file] = `[read failed: ${(error as Error).message}]`;
      }
    }
    return currentFileState;
  }

  private buildDependencyContext(
    task: PlanTask,
    plan: Plan,
    outputs: TaskOutput[],
    receipts: TaskExecutionReceipt[]
  ): { dependencyIds: string[]; outputs: TaskOutput[]; receipts: TaskExecutionReceipt[] } {
    const dependencyIds = [...new Set(plan.dependencies[task.id] ?? [])];
    const outputsById = new Map(outputs.map((output) => [output.taskId, output]));
    const receiptsById = new Map(receipts.map((receipt) => [receipt.taskId, receipt]));

    return {
      dependencyIds,
      outputs: dependencyIds
        .map((dependencyId) => outputsById.get(dependencyId))
        .filter((output): output is TaskOutput => Boolean(output)),
      receipts: dependencyIds
        .map((dependencyId) => receiptsById.get(dependencyId))
        .filter((receipt): receipt is TaskExecutionReceipt => Boolean(receipt))
    };
  }

  private async executeModelToolRequests(task: PlanTask, requests: TaskToolRequest[]): Promise<TaskObservation[]> {
    const observations: TaskObservation[] = [];
    const limitedRequests = requests.slice(0, 3);
    for (const request of limitedRequests) {
      if (!task.requiredTools.includes(request.tool)) {
        observations.push({
          kind: request.tool,
          status: "error",
          summary: `Requested tool ${request.tool} is not allowed for ${task.id}.`,
          content: `Allowed tools: ${task.requiredTools.join(", ")}`,
          nextActions: ["Retry with one of the task's allowed tools or repair the task plan."],
          artifacts: []
        });
        continue;
      }

      switch (request.tool) {
        case "filesystem.read": {
          const paths = (request.input.paths ?? []).slice(0, 5);
          if (paths.length === 0) {
            observations.push({
              kind: "filesystem.read",
              status: "warning",
              summary: "filesystem.read request omitted paths.",
              content: "Provide one or more relative paths in input.paths.",
              nextActions: ["Retry filesystem.read with at least one relative path."],
              artifacts: []
            });
            break;
          }
          for (const path of paths) {
            try {
              const content = await readRelativeFile(this.workdir, path);
              observations.push({
                kind: "filesystem.read",
                status: "success",
                summary: `Read ${path}`,
                content,
                nextActions: [],
                artifacts: [path]
              });
            } catch (error) {
              observations.push({
                kind: "filesystem.read",
                status: "warning",
                summary: `Could not read ${path}`,
                content: `[read failed: ${(error as Error).message}]`,
                nextActions: ["Check whether the requested path exists and is allowed."],
                artifacts: [path]
              });
            }
          }
          break;
        }
        case "filesystem.search":
          observations.push(await searchRepository(this.workdir, request.input.query ?? "", this.config.execution.timeoutMs));
          break;
        case "code.symbols":
          observations.push(await findSymbolDefinitions(this.workdir, request.input.query ?? "", this.config.execution.timeoutMs));
          break;
        case "git.status": {
          const gitStatus = await this.collectGitStatusObservation();
          if (gitStatus) {
            observations.push(gitStatus);
          }
          break;
        }
        case "git.diff": {
          const gitDiff = await this.collectGitDiffObservation();
          if (gitDiff) {
            observations.push(gitDiff);
          }
          break;
        }
        case "verification.command": {
          const requestedCommand = request.input.command?.trim() ?? "";
          if (requestedCommand.length === 0) {
            observations.push({
              kind: "verification.command",
              status: "warning",
              summary: "verification.command request omitted command.",
              content: "Provide one exact command string in input.command.",
              nextActions: ["Retry verification.command with one of the task's declared verificationCommands."],
              artifacts: []
            });
            break;
          }
          if (!task.verificationCommands.includes(requestedCommand)) {
            observations.push({
              kind: "verification.command",
              status: "error",
              summary: "Requested verification command is not allowed for this task.",
              content: `Allowed verification commands: ${task.verificationCommands.join(" || ")}`,
              nextActions: ["Retry with an exact command from the task's declared verificationCommands."],
              artifacts: []
            });
            break;
          }
          const result = await executeShell(requestedCommand, this.workdir, this.config.execution.timeoutMs);
          observations.push({
            kind: "verification.command",
            status: result.exitCode === 0 ? "success" : "warning",
            summary: result.exitCode === 0
              ? `Verification command passed: ${requestedCommand}`
              : `Verification command failed: ${requestedCommand}`,
            content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
            nextActions: result.exitCode === 0
              ? []
              : ["Inspect the command output, fix the failing condition, or choose another declared verification command."],
            artifacts: []
          });
          break;
        }
      }
    }
    return observations;
  }

  private async writeTaskToolTurnsArtifact(
    taskId: string,
    toolTurns: Array<{ turn: number; toolRequests: TaskToolRequest[]; observations: TaskObservation[] }>
  ): Promise<string | null> {
    if (toolTurns.length === 0) {
      return null;
    }
    const artifactPath = resolve(this.runDir, `task-tool-turns-${taskId}.json`);
    await writeFile(artifactPath, JSON.stringify({ taskId, toolTurns }, null, 2), "utf-8");
    return artifactPath;
  }

  private async collectGitStatusObservation(): Promise<TaskObservation | null> {
    const insideRepo = await executeShell("git rev-parse --is-inside-work-tree", this.workdir, this.config.execution.timeoutMs);
    if (insideRepo.exitCode !== 0) {
      return {
        kind: "git.status",
        status: "warning",
        summary: "Working directory is not a git repository.",
        content: [insideRepo.stdout, insideRepo.stderr].filter(Boolean).join("\n").trim() || "git rev-parse returned a non-zero exit code.",
        nextActions: ["Run inside a git worktree or avoid git.status for non-repository tasks."],
        artifacts: []
      };
    }

    const status = await executeShell("git status --short --branch", this.workdir, this.config.execution.timeoutMs);
    const statusContent = [status.stdout, status.stderr].filter(Boolean).join("\n").trim();
    const dirtyEntries = status.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("##"));
    return {
      kind: "git.status",
      status: status.exitCode === 0 ? "success" : "error",
      summary: status.exitCode === 0 ? "Captured git status." : "git status failed.",
      content: statusContent,
      nextActions: status.exitCode === 0 && dirtyEntries.length > 0
        ? ["Inspect git.diff or review the dirty worktree before continuing."]
        : status.exitCode === 0
          ? []
          : ["Check the git command output, then retry git.status."],
      artifacts: []
    };
  }

  private async collectGitDiffObservation(): Promise<TaskObservation | null> {
    const insideRepo = await executeShell("git rev-parse --is-inside-work-tree", this.workdir, this.config.execution.timeoutMs);
    if (insideRepo.exitCode !== 0) {
      return {
        kind: "git.diff",
        status: "warning",
        summary: "Working directory is not a git repository.",
        content: [insideRepo.stdout, insideRepo.stderr].filter(Boolean).join("\n").trim() || "git rev-parse returned a non-zero exit code.",
        nextActions: ["Run inside a git worktree or avoid git.diff for non-repository tasks."],
        artifacts: []
      };
    }

    const diff = await executeShell("git diff --stat", this.workdir, this.config.execution.timeoutMs);
    return {
      kind: "git.diff",
      status: diff.exitCode === 0 ? "success" : "error",
      summary: diff.exitCode === 0 ? "Captured git diff summary." : "git diff failed.",
      content: [diff.stdout, diff.stderr].filter(Boolean).join("\n").trim() || "(no diff output)",
      nextActions: diff.exitCode === 0
        ? (diff.stdout.trim().length > 0
          ? ["Inspect the diff content before approving or expanding changes."]
          : ["Check git.status or stage changes before retrying git.diff."])
        : ["Check the git command output, then retry git.diff."],
      artifacts: []
    };
  }

  private async collectArtifactObservation(kind: string, artifactName: string): Promise<TaskObservation | null> {
    const artifactPath = resolve(this.runDir, artifactName);
    if (!existsSync(artifactPath)) {
      return null;
    }

    const content = await readFile(artifactPath, "utf-8");
    return {
      kind,
      status: "success",
      summary: `Captured ${artifactName}.`,
      content,
      nextActions: [],
      artifacts: [artifactPath]
    };
  }

  private async runVerificationCommands(commands: string[]): Promise<CommandReceipt[]> {
    const verificationResults: CommandReceipt[] = [];
    for (const command of commands) {
      const result = await executeShell(command, this.workdir, this.config.execution.timeoutMs);
      verificationResults.push({
        command: result.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs
      });
    }
    return verificationResults;
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
