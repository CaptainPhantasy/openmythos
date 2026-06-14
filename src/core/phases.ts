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
  VERIFIER_SYSTEM
} from "../prompts/contracts.js";
import { applyFileEdits } from "../tools/files.js";
import { executeShell, type ShellResult } from "../tools/shell.js";
import { parseJsonFromModel } from "./json.js";
import { contextSchema, intakeSchema, planSchema, qaSchema, taskOutputSchema } from "./schemas.js";
import { sortTasks } from "./toposort.js";
import type { AdapterRequest, ContextResult, IntakeResult, Plan, QaResult, TaskOutput } from "./types.js";

export class PhaseExecutor {
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
    const raw = await gatherContext(this.workdir, this.config.context, intake.relevantPatterns);
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
    return await this.callJson("planner", "plan", {
      system: PLANNER_SYSTEM,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      json: true,
      messages: [{
        role: "user",
        content: `Goal:\n${goal}\n\nTask type: ${intake.taskType}\n\nSuccess criteria:\n${intake.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n\nContext summary:\n${context.summary}\n\nRelevant snippets:\n${snippets}\n\n${repairNotes ? `Repair notes from failed verification:\n${repairNotes}` : ""}`
      }]
    }, planSchema) as Plan;
  }

  async execute(plan: Plan, context: ContextResult): Promise<TaskOutput[]> {
    const outputs: TaskOutput[] = [];
    const sorted = sortTasks(plan.tasks, plan.dependencies);
    const snippets = Object.entries(context.relevantSnippets)
      .map(([path, content]) => `=== ${path} ===\n${content}`)
      .join("\n\n");

    for (const task of sorted) {
      const role = task.role === "critic" ? "critic" : "coder";
      const model = this.config.models[role];
      const output = await this.callJson(role, `execute-${task.id}`, {
        system: role === "critic" ? CRITIC_SYSTEM : CODER_SYSTEM,
        maxTokens: model.maxTokens,
        temperature: model.temperature,
        json: true,
        messages: [{
          role: "user",
          content: `Task:\n${JSON.stringify(task, null, 2)}\n\nSuccess criteria:\n${plan.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n\nRelevant snippets:\n${snippets}\n\nPrior outputs:\n${JSON.stringify(outputs, null, 2)}`
        }]
      }, taskOutputSchema) as TaskOutput;
      await applyFileEdits(this.workdir, output.fileEdits, this.runDir);
      outputs.push(output);
    }

    return outputs;
  }

  async verify(goal: string, plan: Plan, outputs: TaskOutput[]): Promise<QaResult> {
    const localResults: ShellResult[] = [];
    for (const command of this.config.verification.localCommands) {
      localResults.push(await executeShell(command, this.workdir, this.config.execution.timeoutMs));
    }

    const localFailures = localResults.filter((result) => result.exitCode !== 0);
    if (this.config.verification.requireLocalPassBeforeModelQa && localFailures.length > 0) {
      return {
        passed: false,
        score: 0,
        issues: localFailures.map((result) => ({
          severity: "critical",
          description: `Local command failed: ${result.command}\nstdout:\n${result.stdout.slice(-2000)}\nstderr:\n${result.stderr.slice(-2000)}`
        })),
        suggestions: ["Fix failing local verification commands before model QA."],
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
        content: `Goal:\n${goal}\n\nSuccess criteria:\n${plan.successCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n\nTask outputs:\n${JSON.stringify(outputs, null, 2)}\n\nLocal verification:\n${JSON.stringify(localResults, null, 2)}\n\nCurrent changed file contents:\n${JSON.stringify(fileState, null, 2)}`
      }]
    }, qaSchema) as QaResult;
  }

  repairNotes(qa: QaResult): string {
    return qa.issues
      .map((issue) => `[${issue.severity}] ${issue.file ? `${issue.file}: ` : ""}${issue.description}${issue.suggestedFix ? `\nSuggested fix: ${issue.suggestedFix}` : ""}`)
      .join("\n\n");
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
}

export function artifactPath(runDir: string, name: string): string {
  return resolve(runDir, name);
}
