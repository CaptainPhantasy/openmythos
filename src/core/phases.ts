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
import { executeCommand, executeShell, type ShellResult } from "../tools/shell.js";
import { findSymbolDefinitions, searchRepository } from "../tools/retrieval.js";
import { parseJsonFromModel } from "./json.js";
import { ApprovalRequiredError, ToolApprovalRequiredError, createReviewBundle } from "./review.js";
import { contextSchema, intakeSchema, planSchema, qaSchema, taskOutputSchema, taskStepSchema } from "./schemas.js";
import {
  formatHarnessActionCatalogForPrompt,
  formatToolCatalogForPrompt,
  normalizePlanTools,
  summarizeToolValidationIssues
} from "./tooling.js";
import { buildExecutionBatches } from "./toposort.js";
import { scanForSecrets, summarizeRisk, type SecurityFinding } from "./guardrails.js";
import { routeModel, defaultRoutingPolicies, classifyComplexity, classifyRisk } from "./model-routing.js";
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
      return this.applyRouting(normalized.plan, intake);
    }

    const toolRepairNotes = summarizeToolValidationIssues(normalized.issues);
    planned = await this.callJson("planner", "plan", buildPlanRequest(`Tooling corrections required:\n${toolRepairNotes}\nUse only supported tool ids, and make them compatible with the task role.`), planSchema) as Plan;
    normalized = normalizePlanTools(planned);
    if (normalized.issues.length > 0) {
      const roleRepairedPlan = this.repairHarnessTaskRoles(normalized.plan);
      const roleRepairedNormalized = normalizePlanTools(roleRepairedPlan);
      if (roleRepairedNormalized.issues.length === 0) {
        return this.applyRouting(roleRepairedNormalized.plan, intake);
      }
      throw new Error(`Plan referenced unsupported or mismatched tools after repair:\n${summarizeToolValidationIssues(normalized.issues)}`);
    }

    return this.applyRouting(normalized.plan, intake);
  }

  private repairHarnessTaskRoles(plan: Plan): Plan {
    const repairedTasks = plan.tasks.map((task) => task.executor === "harness" && task.role !== "verifier"
      ? { ...task, role: "verifier" as const }
      : task
    );
    return {
      ...plan,
      tasks: repairedTasks
    };
  }

  private applyRouting(plan: Plan, intake: IntakeResult): Plan {
    const policies = defaultRoutingPolicies();
    const routedTasks = plan.tasks.map((task) => {
      if (task.executor === "harness") return task;
      const complexity = classifyComplexity(task.description, task.fileTargets.length, task.acceptanceCriteria.length * 20);
      const riskLevel = classifyRisk(task.fileTargets.length, false, false);
      const decision = routeModel(
        { type: intake.taskType, complexity, riskLevel, requiresTools: task.requiredTools.length > 0 },
        policies
      );
      return { ...task, routing: { taskType: intake.taskType, complexity, riskLevel, routedRole: decision.role, routingReason: decision.reason } };
    });
    return { ...plan, tasks: routedTasks };
  }

  async execute(plan: Plan, context: ContextResult, intake?: IntakeResult, bypassReviewBlocking = false): Promise<TaskOutput[]> {
    const outputs: TaskOutput[] = [];
    this.taskReceipts = [];
    const batches = buildExecutionBatches(plan.tasks, plan.dependencies);

    for (const batch of batches) {
      const batchOutputs = await Promise.all(batch.map(async (task) => {
        const resolvedTask: PlanTask = {
          ...task,
          verificationCommands: this.resolveTaskVerificationCommands(task, intake ?? null)
        };
        const execution = await this.executeTask(resolvedTask, plan, context, outputs, bypassReviewBlocking);
        const review = await createReviewBundle(
          this.workdir,
          this.runDir,
          resolvedTask.id,
          execution.output.fileEdits,
          this.config.approval
        );
        return { task: resolvedTask, execution, review };
      }));

      for (const item of batchOutputs) {
        this.reviews.push(item.review);
        if (item.review.blocking && !bypassReviewBlocking) {
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

  async verify(goal: string, plan: Plan, outputs: TaskOutput[], intake: IntakeResult): Promise<QaResult> {
    const localResults: ShellResult[] = [];
    const localVerificationCommands = this.resolveVerificationCommandSet(
      this.config.verification.localCommands,
      intake,
      `goal: ${goal}\n${plan.goal}\n${plan.successCriteria.join("\n")}`
    );
    for (const command of localVerificationCommands) {
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

    const guardrailFindings: SecurityFinding[] = [];
    if (this.config.guardrails?.secretScan !== false) {
      for (const file of changedFiles) {
        const content = fileState[file];
        if (content && !content.startsWith("[read failed:")) {
          guardrailFindings.push(...scanForSecrets(content, file));
        }
      }
    }
    const guardrailSummary = summarizeRisk(guardrailFindings);
    if (guardrailSummary.level === "dangerous") {
      return {
        passed: false,
        score: 0,
        issues: guardrailFindings.map((f) => ({
          severity: "critical" as const,
          description: `[${f.type}] ${f.description} in ${f.file}${f.line ? `:${f.line}` : ""} — ${f.recommendation}`,
          file: f.file,
          line: f.line,
          suggestedFix: f.recommendation,
        })),
        suggestions: ["Remove hardcoded secrets before proceeding. Use environment variables or a secrets manager."],
        verifiedCriteria: [],
        failedCriteria: plan.successCriteria,
      };
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

  private resolveTaskVerificationCommands(task: PlanTask, intake: IntakeResult | null): string[] {
    const context = `${task.title}\n${task.description}\n${task.acceptanceCriteria.join("\n")}\n${task.fileTargets.join("\n")} ${task.contextQueries.join(" ")} ${task.harnessAction ?? ""}`;
    return this.resolveVerificationCommandSet(task.verificationCommands, intake, context);
  }

  private resolveVerificationCommandSet(
    explicitCommands: string[],
    intake: IntakeResult | null,
    contextText: string
  ): string[] {
    const commands = new Set<string>();
    for (const command of explicitCommands) {
      if (command.trim().length > 0) {
        commands.add(command.trim());
      }
    }

    const presets = this.config.verification.presets;
    for (const command of presets.default) {
      if (command.trim().length > 0) {
        commands.add(command.trim());
      }
    }

    if (intake) {
      for (const command of presets.byRisk[intake.complexity] ?? []) {
        if (command.trim().length > 0) {
          commands.add(command.trim());
        }
      }

      const matchText = `${intake.taskType} ${intake.description} ${intake.successCriteria.join(" ")} ${contextText}`;
      const taskTypeCommands = this.matchTaskTypePresets(matchText);
      for (const command of taskTypeCommands) {
        if (command.trim().length > 0) {
          commands.add(command.trim());
        }
      }
    }

    return [...commands];
  }

  private matchTaskTypePresets(text: string): string[] {
    const lower = text.toLowerCase();
    const byTaskType = this.config.verification.presets.byTaskType;
    const matchedCommands: string[] = [];
    const typeBuckets: Array<{ key: keyof typeof byTaskType; patterns: string[] }> = [
      { key: "lint", patterns: ["lint", "eslint", "prettier", "format"] },
      { key: "build", patterns: ["build", "compile", "bundle", "tsc", "vite", "webpack", "rollup"] },
      { key: "test", patterns: ["test", "unit", "spec", "vitest", "jest", "mocha"] },
      { key: "browser", patterns: ["browser", "ui", "frontend", "playwright", "cypress", "e2e", "smoke"] },
      { key: "api", patterns: ["api", "endpoint", "swagger", "openapi", "request", "route"] },
      { key: "database", patterns: ["database", "db", "sql", "sqlite", "query", "migration"] },
      { key: "security", patterns: ["security", "audit", "sast", "license", "dependency", "secret"] },
      { key: "performance", patterns: ["performance", "load", "latency", "benchmark", "profile"] }
    ];

    const seen = new Set<string>();
    for (const bucket of typeBuckets) {
      if (bucket.patterns.some((pattern) => lower.includes(pattern))) {
        for (const command of byTaskType[bucket.key] ?? []) {
          if (!seen.has(command)) {
            seen.add(command);
            matchedCommands.push(command);
          }
        }
      }
    }
    return matchedCommands;
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
    context: ContextResult,
    priorOutputs: TaskOutput[],
    bypassToolApproval = false
  ): Promise<{
    output: TaskOutput;
    executorKind: PlanTask["executor"];
    executorRole: PlanTask["role"];
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

    const taskSnippets = this.buildTaskSnippetContext(task, context, dependencyContext);
    if (Object.keys(taskSnippets).length > 0) {
      const artifactPath = resolve(this.runDir, `task-snippets-${task.id}.json`);
      await writeFile(
        artifactPath,
        JSON.stringify({ taskId: task.id, snippets: taskSnippets }, null, 2),
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

    const loopResult = await this.executeModelTaskLoop(task, plan, taskSnippets, dependencyContext, taskContextObservations, bypassToolApproval);
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
    executorRole: PlanTask["role"],
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
    taskSnippets: Record<string, string>,
    dependencyContext: { dependencyIds: string[]; outputs: TaskOutput[]; receipts: TaskExecutionReceipt[] },
    taskContextObservations: TaskObservation[],
    bypassToolApproval = false
  ): Promise<{
    output: TaskOutput;
    toolTurnCount: number;
    toolCallCount: number;
    toolObservations: TaskObservation[];
    artifactPath: string | null;
  }> {
    const taskRole = task.role;
    const role = taskRole === "researcher" ? "planner" as const
      : taskRole === "tester" || taskRole === "refactorer" || taskRole === "documenter" ? "coder" as const
      : taskRole;
    const model = this.config.models[role];
    const currentFileState = await this.readCurrentFileState(task);
    const snippets = Object.entries(taskSnippets)
      .map(([path, content]) => `=== ${path} ===\n${content}`)
      .join("\n\n");
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

      const observations = await this.executeModelToolRequests(task, step.toolRequests, bypassToolApproval);
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

  private buildTaskSnippetContext(
    task: PlanTask,
    context: ContextResult,
    dependencyContext: { dependencyIds: string[]; outputs: TaskOutput[]; receipts: TaskExecutionReceipt[] }
  ): Record<string, string> {
    const snippetEntries = Object.entries(context.relevantSnippets);
    if (snippetEntries.length === 0) {
      return {};
    }

    const queryTerms = this.extractTaskQueryTerms(task);
    const dependencyTargets = new Set(
      dependencyContext.outputs
        .flatMap((output) => output.fileEdits.map((edit) => edit.path.toLowerCase()))
    );
    const selected = snippetEntries.filter(([path, content]) => {
      const lowerPath = path.toLowerCase();
      if (task.fileTargets.some((target) => target.toLowerCase() === lowerPath)) {
        return true;
      }
      if (dependencyTargets.has(lowerPath)) {
        return true;
      }
      if (queryTerms.length === 0) {
        return false;
      }
      const haystack = `${path}\n${content}`.toLowerCase();
      return queryTerms.some((term) => haystack.includes(term));
    });

    if (selected.length > 0) {
      return Object.fromEntries(selected);
    }

    const fallbacks = snippetEntries.filter(([path]) =>
      task.fileTargets.some((target) => target.toLowerCase() === path.toLowerCase())
    );
    return Object.fromEntries(fallbacks);
  }

  private extractTaskQueryTerms(task: PlanTask): string[] {
    const contextTerms = task.contextQueries
      .map((query) => query.trim().toLowerCase())
      .filter((query) => query.length >= 3);

    if (contextTerms.length > 0) {
      return [...new Set(contextTerms)];
    }

    return [...new Set(
      [...task.fileTargets, task.title]
        .join("\n")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3)
    )];
  }

  private async executeModelToolRequests(task: PlanTask, requests: TaskToolRequest[], bypassApproval = false): Promise<TaskObservation[]> {
    const observations: TaskObservation[] = [];
    const limitedRequests = requests.slice(0, 3);
    for (const request of limitedRequests) {
      const risk = this.assessToolRequestRisk(task.id, request);
      if (risk.level === "high" && !bypassApproval) {
        if (this.config.approval.mode === "enforce") {
          const artifactPath = await this.writeToolApprovalArtifact(task.id, request, risk.reason);
          throw new ToolApprovalRequiredError({
            taskId: task.id,
            tool: request.tool,
            mode: this.config.approval.mode,
            reason: risk.reason,
            request,
            artifactPath
          });
        }
        if (this.config.approval.mode === "suggest") {
          observations.push({
            kind: request.tool,
            status: "warning",
            summary: "Model tool request is high-risk and running in suggest mode.",
            content: risk.reason,
            nextActions: ["Review this request and switch approval mode to enforce when proceeding in production."],
            artifacts: []
          });
        }
      }

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
        case "shell.run": {
          observations.push(await this.executeShellTool(request.input.command ?? ""));
          break;
        }
        case "package.install": {
          observations.push(await this.executePackageInstallTool(request.input.command ?? ""));
          break;
        }
        case "git.branch": {
          observations.push(await this.executeGitBranchTool(request));
          break;
        }
        case "git.stage": {
          observations.push(await this.executeGitStageTool(request));
          break;
        }
        case "git.commit": {
          observations.push(await this.executeGitCommitTool(request));
          break;
        }
        case "browser.verify": {
          observations.push(await this.executeBrowserVerifyTool(request.input));
          break;
        }
        case "api.request": {
          observations.push(await this.executeApiRequestTool(request.input));
          break;
        }
        case "database.query": {
          observations.push(await this.executeDatabaseQueryTool(request.input));
          break;
        }
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

  private assessToolRequestRisk(taskId: string, request: TaskToolRequest): { level: "low" | "medium" | "high"; reason: string } {
    if (request.tool === "shell.run") {
      const command = (request.input.command ?? "").trim().toLowerCase();
      if (/\b(rm|rmdir|mv)\b/.test(command)) {
        return { level: "high", reason: `Task ${taskId} requested a destructive shell command: ${command}` };
      }
      return { level: "low", reason: "shell.run request is not flagged as destructive." };
    }

    if (request.tool === "package.install") {
      const command = (request.input.command ?? "").trim().toLowerCase();
      if (/(^|\s)(-g|--global)\b/.test(command)) {
        return { level: "high", reason: `Task ${taskId} requested a global package change: ${command}` };
      }
      if (/uninstall\b/.test(command)) {
        return { level: "high", reason: `Task ${taskId} requested a package uninstall: ${command}` };
      }
      return { level: "low", reason: "package.install request is scoped and non-destructive." };
    }

    if (request.tool === "git.branch") {
      const action = (request.input.command ?? "").trim().toLowerCase();
      if (action === "delete" || action === "delete-force" || action === "force-delete") {
        return { level: "high", reason: `Task ${taskId} requested a high-risk git branch deletion: ${action}` };
      }
      return { level: "low", reason: "git.branch request is within normal branch operations." };
    }

    if (request.tool === "git.stage") {
      const command = (request.input.command ?? "").trim().toLowerCase();
      return command.includes("unstage")
        ? { level: "medium", reason: "git.stage request is an unstage operation." }
        : { level: "low", reason: "git.stage request is a staging operation." };
    }

    if (request.tool === "git.commit") {
      return { level: "high", reason: `Task ${taskId} requested a git commit operation.` };
    }

    if (request.tool === "api.request") {
      const requestText = (request.input.command ?? "").trim();
      const parsed = this.parseApiRequest(requestText);
      if (!parsed.ok) {
        return { level: "high", reason: `Task ${taskId} requested an invalid API call shape: ${parsed.reason}` };
      }
      if (parsed.method !== "GET") {
        return { level: "high", reason: `Task ${taskId} requested a non-GET API request: ${parsed.method} ${parsed.url}` };
      }
      return { level: "low", reason: "api.request is read-only GET request." };
    }

    return { level: "low", reason: "tool request has no explicit high-risk classification." };
  }

  private async writeToolApprovalArtifact(taskId: string, request: TaskToolRequest, reason: string): Promise<string> {
    const artifactPath = resolve(this.runDir, `tool-approval-${taskId}-${Date.now()}.json`);
    await writeFile(
      artifactPath,
      JSON.stringify({
        taskId,
        tool: request.tool,
        request,
        reason,
        timestamp: new Date().toISOString()
      }, null, 2),
      "utf-8"
    );
    return artifactPath;
  }

  private async executeShellTool(command: string): Promise<TaskObservation> {
    const requestedCommand = command.trim();
    if (requestedCommand.length === 0) {
      return {
        kind: "shell.run",
        status: "warning",
        summary: "shell.run request omitted command.",
        content: "Provide one exact command string in input.command.",
        nextActions: ["Retry shell.run with a bounded command string."],
        artifacts: []
      };
    }

    const validation = this.validateCommandShape(requestedCommand);
    if (!validation.ok) {
      return {
        kind: "shell.run",
        status: "error",
        summary: "shell.run command was rejected for safety.",
        content: validation.reason,
        nextActions: ["Use one simple command from the allowed shell run list and avoid shell metacharacters."],
        artifacts: []
      };
    }

    const result = await executeShell(requestedCommand, this.workdir, this.config.execution.timeoutMs);
    return {
      kind: "shell.run",
      status: result.exitCode === 0 ? "success" : "warning",
      summary: result.exitCode === 0 ? `shell.run succeeded: ${requestedCommand}` : `shell.run failed: ${requestedCommand}`,
      content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
      nextActions: result.exitCode === 0
        ? []
        : ["Inspect the command output and retry with a corrected allowed shell command."],
      artifacts: []
    };
  }

  private async executePackageInstallTool(command: string): Promise<TaskObservation> {
    const requestedCommand = command.trim();
    if (requestedCommand.length === 0) {
      return {
        kind: "package.install",
        status: "warning",
        summary: "package.install request omitted command.",
        content: "Provide a package manager install command in input.command.",
        nextActions: ["Retry package.install with a bounded install command such as npm install --dry-run."],
        artifacts: []
      };
    }

    const safeCommand = this.normalizePackageInstallCommand(requestedCommand);
    if (safeCommand === null) {
      return {
        kind: "package.install",
        status: "error",
        summary: "package.install command is not permitted.",
        content: `Disallowed or unsafe package command: ${requestedCommand}`,
        nextActions: ["Use npm/pnpm/yarn install commands with --dry-run only."],
        artifacts: []
      };
    }

    const result = await executeShell(safeCommand, this.workdir, this.config.execution.timeoutMs);
    return {
      kind: "package.install",
      status: result.exitCode === 0 ? "success" : "warning",
      summary: result.exitCode === 0
        ? `Package install command completed safely: ${safeCommand}`
        : `Package install command failed: ${safeCommand}`,
      content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
      nextActions: result.exitCode === 0
        ? ["Review the package command output for warnings or security concerns before proceeding."]
        : ["Fix the package command or retry with a compatible --dry-run install command."],
      artifacts: []
    };
  }

  private async executeGitBranchTool(request: TaskToolRequest): Promise<TaskObservation> {
    const action = (request.input.command ?? "").trim().toLowerCase();
    const branchName = (request.input.query ?? "").trim();
    const safeBranches = branchName.length === 0 ? [] : this.splitSafeShellArguments(branchName);
    const requestedCommand = action.length === 0 ? (safeBranches.length === 0 ? "list" : "create") : action;

    if (safeBranches.some((part) => /["'`$]/.test(part))) {
      return {
        kind: "git.branch",
        status: "error",
        summary: "git.branch request contains unsafe branch text.",
        content: `Unsafe branch token detected in ${branchName}`,
        nextActions: ["Retry git.branch with a simple branch name using URL-safe characters only."],
        artifacts: []
      };
    }

    let gitCommand = "git branch";
    if (requestedCommand === "create" || requestedCommand === "new" || requestedCommand === "branch") {
      if (branchName.length === 0) {
        return {
          kind: "git.branch",
          status: "error",
          summary: "git.branch create requested without branch name.",
          content: "Use input.query with the branch name and leave command empty or set command to \"create\".",
          nextActions: ["Retry with a non-empty branch name in input.query."],
          artifacts: []
        };
      }
      gitCommand = `git branch ${this.shellQuote(branchName)}`;
    } else if (requestedCommand === "switch" || requestedCommand === "checkout" || requestedCommand === "checkout -b") {
      if (branchName.length === 0) {
        return {
          kind: "git.branch",
          status: "error",
          summary: "git.branch switch requested without branch name.",
          content: "Use input.query with a branch name and command set to \"switch\".",
          nextActions: ["Retry with a branch name in input.query."],
          artifacts: []
        };
      }
      gitCommand = requestedCommand === "switch"
        ? `git switch ${this.shellQuote(branchName)}`
        : `git checkout ${this.shellQuote(branchName)}`;
    } else if (requestedCommand === "status" || requestedCommand === "current") {
      gitCommand = "git branch --show-current";
    } else if (requestedCommand === "delete") {
      if (branchName.length === 0) {
        return {
          kind: "git.branch",
          status: "error",
          summary: "git.branch delete requested without branch name.",
          content: "Use input.query with a branch name and command set to \"delete\".",
          nextActions: ["Retry with a branch name in input.query."],
          artifacts: []
        };
      }
      gitCommand = `git branch -d ${this.shellQuote(branchName)}`;
    } else if (requestedCommand === "force-delete" || requestedCommand === "delete-force") {
      if (branchName.length === 0) {
        return {
          kind: "git.branch",
          status: "error",
          summary: "git.branch delete-force requested without branch name.",
          content: "Use input.query with a branch name and command set to \"delete-force\".",
          nextActions: ["Retry with a branch name in input.query."],
          artifacts: []
        };
      }
      gitCommand = `git branch -D ${this.shellQuote(branchName)}`;
    } else if (requestedCommand === "list" || requestedCommand === "show") {
      gitCommand = "git branch --color=never";
    } else {
      if (branchName.length > 0 && (action.length === 0 || action === "create")) {
        gitCommand = `git branch ${this.shellQuote(branchName)}`;
      } else {
        return {
          kind: "git.branch",
          status: "warning",
          summary: `Unsupported git.branch command: ${action}`,
          content: "Use one of: list, status, create, switch, delete, delete-force",
          nextActions: ["Retry git.branch with a supported command value."],
          artifacts: []
        };
      }
    }

    const result = await executeShell(gitCommand, this.workdir, this.config.execution.timeoutMs);
    return {
      kind: "git.branch",
      status: result.exitCode === 0 ? "success" : "warning",
      summary: result.exitCode === 0 ? `git.branch executed: ${gitCommand}` : `git.branch failed: ${gitCommand}`,
      content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
      nextActions: result.exitCode === 0
        ? []
        : ["Check git command output and rerun git.branch with a supported action and branch name."],
      artifacts: []
    };
  }

  private async executeGitStageTool(request: TaskToolRequest): Promise<TaskObservation> {
    const targets = (request.input.paths ?? []).slice(0, 15);
    if (targets.length === 0) {
      return {
        kind: "git.stage",
        status: "warning",
        summary: "git.stage request omitted paths.",
        content: "Provide one or more relative paths in input.paths.",
        nextActions: ["Retry git.stage with at least one path."],
        artifacts: []
      };
    }
    const lowerOperation = (request.input.command ?? "").trim().toLowerCase();
    const operation = lowerOperation.includes("unstage") ? "unstage" : "stage";
    const command = operation === "unstage"
      ? ["restore", "--staged", "--", ...targets]
      : ["add", "--", ...targets];

    const result = await executeCommand("git", command, this.workdir, this.config.execution.timeoutMs);
    return {
      kind: "git.stage",
      status: result.exitCode === 0 ? "success" : "warning",
      summary: result.exitCode === 0
        ? `git.stage ${operation} completed for ${targets.length} file(s).`
        : `git.stage ${operation} failed for ${targets.length} file(s).`,
      content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
      nextActions: result.exitCode === 0
        ? []
        : ["Check requested paths and repository state, then retry git.stage."],
      artifacts: []
    };
  }

  private async executeGitCommitTool(request: TaskToolRequest): Promise<TaskObservation> {
    const commitMessage = (request.input.query ?? request.input.command ?? "work-item update").trim().replaceAll("\n", " ");
    const safeMessage = commitMessage.length === 0 ? "work-item update" : commitMessage;
    if (!safeMessage) {
      return {
        kind: "git.commit",
        status: "warning",
        summary: "git.commit request missing message.",
        content: "Provide a commit message in input.query or input.command.",
        nextActions: ["Retry git.commit with a short commit message."],
        artifacts: []
      };
    }

    const result = await executeCommand("git", ["commit", "-m", safeMessage, "--allow-empty"], this.workdir, this.config.execution.timeoutMs);
    return {
      kind: "git.commit",
      status: result.exitCode === 0 ? "success" : "warning",
      summary: result.exitCode === 0 ? `git.commit recorded: ${safeMessage}` : "git.commit failed",
      content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
      nextActions: result.exitCode === 0
        ? ["Review commit output before moving to the next task."]
        : ["Check git status/diff and retry git.commit with a valid message."],
      artifacts: []
    };
  }

  private async executeBrowserVerifyTool(input: TaskToolRequest["input"]): Promise<TaskObservation> {
    const endpoint = (input.query ?? input.command ?? "").trim();
    if (!endpoint) {
      return {
        kind: "browser.verify",
        status: "warning",
        summary: "browser.verify request omitted target endpoint.",
        content: "Provide a URL in input.query or input.command.",
        nextActions: ["Retry browser.verify with a full http:// or https:// URL."],
        artifacts: []
      };
    }
    const marker = input.command?.trim() && input.command !== endpoint ? input.command.trim() : "";
    if (!this.isSafeHttpUrl(endpoint)) {
      return {
        kind: "browser.verify",
        status: "error",
        summary: "browser.verify endpoint is invalid.",
        content: `Invalid endpoint: ${endpoint}`,
        nextActions: ["Use a validated http:// or https:// URL string."],
        artifacts: []
      };
    }

    const command = `curl -fsS -m 5 ${this.shellQuote(endpoint)}`;
    const result = await executeShell(command, this.workdir, this.config.execution.timeoutMs);
    if (marker.length > 0 && !result.stdout.includes(marker)) {
      return {
        kind: "browser.verify",
        status: "warning",
        summary: `browser.verify executed but marker not found at ${endpoint}`,
        content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
        nextActions: ["Check endpoint response and expected marker text."],
        artifacts: []
      };
    }

    return {
      kind: "browser.verify",
      status: result.exitCode === 0 ? "success" : "warning",
      summary: result.exitCode === 0
        ? `browser.verify returned success for ${endpoint}`
        : `browser.verify failed for ${endpoint}`,
      content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
      nextActions: result.exitCode === 0
        ? []
        : ["Confirm the endpoint is reachable and retry with the expected path or marker."],
      artifacts: []
    };
  }

  private async executeApiRequestTool(input: TaskToolRequest["input"]): Promise<TaskObservation> {
    const request = (input.command ?? "").trim();
    const parsed = this.parseApiRequest(request);
    if (!parsed.ok) {
      return {
        kind: "api.request",
        status: "error",
        summary: "api.request payload is invalid.",
        content: parsed.reason,
        nextActions: ["Use METHOD URL format, for example: GET https://host/api/health"],
        artifacts: []
      };
    }

    const args = ["-fsS", "-m", "5", "-X", parsed.method, parsed.url];
    if (parsed.body !== null) {
      args.push("-H", "content-type: application/json", "-d", parsed.body);
    }

    const result = await executeCommand("curl", args, this.workdir, this.config.execution.timeoutMs);
    return {
      kind: "api.request",
      status: result.exitCode === 0 ? "success" : "warning",
      summary: result.exitCode === 0 ? `api.request completed: ${parsed.method} ${parsed.url}` : `api.request failed: ${parsed.method} ${parsed.url}`,
      content: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.exitCode})`,
      nextActions: result.exitCode === 0
        ? []
        : ["Check request parameters and retry with a valid method/url."],
      artifacts: []
    };
  }

  private async executeDatabaseQueryTool(input: TaskToolRequest["input"]): Promise<TaskObservation> {
    const query = (input.query ?? "").trim();
    const databasePath = (input.paths ?? [""])[0]?.trim();
    if (!databasePath || databasePath.length === 0 || query.length === 0) {
      return {
        kind: "database.query",
        status: "warning",
        summary: "database.query request omitted file or query.",
        content: "Provide database file path in input.paths[0] and query text in input.query.",
        nextActions: ["Retry database.query with both a target file and a query string."],
        artifacts: []
      };
    }

    if (!existsSync(resolve(this.workdir, databasePath))) {
      return {
        kind: "database.query",
        status: "error",
        summary: "database.query target file does not exist.",
        content: `Missing path: ${databasePath}`,
        nextActions: ["Use an existing local file path relative to the workdir."],
        artifacts: []
      };
    }

    try {
      const raw = await readFile(resolve(this.workdir, databasePath), "utf8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        return {
          kind: "database.query",
          status: "warning",
          summary: "database.query only supports array JSON payloads today.",
          content: `Loaded ${databasePath} but top-level value was not an array.`,
          nextActions: ["Use a JSON array file for database.query demonstrations in this phase."],
          artifacts: []
        };
      }

      const normalizedQuery = query.toLowerCase();
      if (normalizedQuery === "count" || normalizedQuery === "count(*)") {
        return {
          kind: "database.query",
          status: "success",
          summary: `database.query counted ${data.length} rows from ${databasePath}`,
          content: JSON.stringify({ count: data.length }),
          nextActions: [],
          artifacts: []
        };
      }

      const whereMatch = query.match(/^where\s+([a-z0-9_]+)\s*=\s*([^\s].*)$/i);
      if (!whereMatch) {
        return {
          kind: "database.query",
          status: "warning",
          summary: "database.query only supports `where <field>=<value>` or `count(*)` in this phase.",
          content: `Unsupported query: ${query}`,
          nextActions: ["Use count(*) or where filters such as `where status=ready`."],
          artifacts: []
        };
      }

      const field = whereMatch[1] ?? "";
      const expected = (whereMatch[2] ?? "").replace(/^['"]|['"]$/g, "");
      const matched = data.filter((row) => {
        if (row && typeof row === "object" && field in row) {
          return String((row as Record<string, unknown>)[field]) === expected;
        }
        return false;
      });
      return {
        kind: "database.query",
        status: "success",
        summary: `database.query matched ${matched.length} row(s) in ${databasePath}`,
        content: JSON.stringify(matched),
        nextActions: [],
        artifacts: []
      };
    } catch (error) {
      return {
        kind: "database.query",
        status: "error",
        summary: "database.query execution failed.",
        content: `[database query failed: ${(error as Error).message}]`,
        nextActions: ["Verify the JSON file and query string format."],
        artifacts: []
      };
    }
  }

  private validateCommandShape(command: string): { ok: boolean; reason: string } {
    if (/[;&|]|\$\(|\`/.test(command)) {
      return { ok: false, reason: "disallowed shell metacharacters" };
    }

    const parts = this.splitSafeShellArguments(command);
    if (parts.length === 0) {
      return { ok: false, reason: "empty command parts" };
    }

    const allowed = [
      "cat",
      "echo",
      "find",
      "git",
      "ls",
      "mkdir",
      "npm",
      "node",
      "pwd",
      "printf",
      "rm",
      "sed",
      "tail",
      "test",
      "touch",
      "true",
      "head"
    ];
    if (!allowed.includes(parts[0]?.toLowerCase() ?? "")) {
      return { ok: false, reason: `command ${parts[0]} is not in allowed shell set` };
    }

    return { ok: true, reason: "ok" };
  }

  private normalizePackageInstallCommand(command: string): string | null {
    const trimmed = command.trim();
    if (!/^(npm|pnpm|yarn)\s+install\b/i.test(trimmed)) {
      return null;
    }
    if (!/\s--dry-run(\s|$)/.test(trimmed)) {
      return `${trimmed} --dry-run`;
    }
    return trimmed;
  }

  private parseApiRequest(raw: string): { ok: boolean; method: string; url: string; body: string | null; reason: string } {
    const match = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i.exec(raw.trim());
    if (!match) {
      return { ok: false, method: "", url: "", body: null, reason: "Expected METHOD URL with optional spaces only." };
    }

    const method = (match[1] ?? "").toUpperCase();
    const remainder = (match[2] ?? "").trim();
    const [url, ...bodyParts] = remainder.split(" ");
    if (!url) {
      return { ok: false, method, url: "", body: null, reason: "Expected METHOD URL with optional spaces only." };
    }
    if (!this.isSafeHttpUrl(url)) {
      return { ok: false, method, url, body: null, reason: `Unsafe URL: ${url}` };
    }
    const body = bodyParts.length > 0
      ? bodyParts.join(" ").trim() || null
      : null;
    return { ok: true, method, url, body, reason: "ok" };
  }

  private isSafeHttpUrl(candidate: string): boolean {
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  private splitSafeShellArguments(value: string): string[] {
    const match = value.match(/(?:"([^"]*)"|'([^']*)'|([^\s]+))/g);
    if (!match) {
      return [];
    }
    return match.map((token) => token.replace(/^['"]|['"]$/g, ""));
  }

  private shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
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
