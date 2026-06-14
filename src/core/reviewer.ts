import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OpenMythosConfig } from "../config/schema.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { REVIEW_SYSTEM } from "../prompts/contracts.js";
import { reviewSchema } from "./schemas.js";
import { parseJsonFromModel } from "./json.js";
import type { AdapterRequest, QaIssue, ReviewResult } from "./types.js";
import { executeCommand } from "../tools/shell.js";
import { readRelativeFile } from "../tools/files.js";

export interface ReviewCliOptions {
  cached?: boolean;
  base?: string;
  head?: string;
  outputDir?: string;
}

export interface ChangedFileSnapshot {
  path: string;
  status: string;
  content: string | null;
}

export interface ReviewInput {
  repoRoot: string;
  statusText: string;
  diff: string;
  changedFiles: ChangedFileSnapshot[];
}

export interface ReviewArtifacts {
  jsonPath: string;
  markdownPath: string;
}

export interface ReviewRunResult {
  generatedAt: string;
  input: ReviewInput;
  result: ReviewResult;
  artifacts: ReviewArtifacts;
}

export async function collectGitReviewInput(
  workdir: string,
  options: ReviewCliOptions = {},
  limits: { maxFiles?: number; maxFileBytes?: number; timeoutMs?: number } = {}
): Promise<ReviewInput> {
  const timeoutMs = limits.timeoutMs ?? 30_000;
  const maxFiles = limits.maxFiles ?? 25;
  const maxFileBytes = limits.maxFileBytes ?? 40_000;
  const repoRoot = await gitRepoRoot(workdir, timeoutMs);
  const args = buildDiffArgs(options);

  const [statusResult, diffResult, nameStatusResult] = await Promise.all([
    executeCommand("git", ["status", "--short", "--untracked-files=all"], repoRoot, timeoutMs),
    executeCommand("git", args, repoRoot, timeoutMs),
    executeCommand("git", [...args, "--name-status"], repoRoot, timeoutMs)
  ]);

  if (statusResult.exitCode !== 0) {
    throw new Error(`git status failed: ${statusResult.stderr || statusResult.stdout}`);
  }
  if (diffResult.exitCode !== 0) {
    throw new Error(`git diff failed: ${diffResult.stderr || diffResult.stdout}`);
  }
  if (nameStatusResult.exitCode !== 0) {
    throw new Error(`git diff --name-status failed: ${nameStatusResult.stderr || nameStatusResult.stdout}`);
  }

  const includeStatusShort = !options.cached && !options.base && !options.head;
  const changedFiles = await collectChangedFiles(repoRoot, mergeChangedFiles(
    includeStatusShort ? statusResult.stdout : "",
    nameStatusResult.stdout
  ).slice(0, maxFiles), maxFileBytes);

  return {
    repoRoot,
    statusText: statusResult.stdout.trim(),
    diff: diffResult.stdout.trim(),
    changedFiles
  };
}

export async function runReview(
  config: OpenMythosConfig,
  workdir: string,
  options: ReviewCliOptions = {}
): Promise<ReviewRunResult> {
  const input = await collectGitReviewInput(workdir, options, {
    timeoutMs: config.execution.timeoutMs
  });
  const generatedAt = new Date().toISOString();

  const result = input.diff.length === 0 && input.changedFiles.length === 0
    ? {
        verdict: "clean",
        summary: "No local repository changes found to review.",
        findings: [],
        strengths: []
      } satisfies ReviewResult
    : await reviewWithModel(config, input);

  const outputDir = resolve(input.repoRoot, options.outputDir ?? "reviews");
  await mkdir(outputDir, { recursive: true });
  const artifactName = `review-${generatedAt.replace(/[:.]/g, "-")}`;
  const jsonPath = resolve(outputDir, `${artifactName}.json`);
  const markdownPath = resolve(outputDir, `${artifactName}.md`);

  const payload = {
    generatedAt,
    options: {
      cached: Boolean(options.cached),
      ...(options.base ? { base: options.base } : {}),
      ...(options.head ? { head: options.head } : {})
    },
    input,
    result
  };

  await writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await writeFile(markdownPath, buildReviewMarkdown(payload));

  return {
    generatedAt,
    input,
    result,
    artifacts: {
      jsonPath,
      markdownPath
    }
  };
}

export function buildReviewMarkdown(review: {
  generatedAt: string;
  input: ReviewInput;
  result: ReviewResult;
}): string {
  const lines: string[] = [];
  lines.push("# OpenMythos Review Report");
  lines.push("");
  lines.push(`Generated: ${review.generatedAt}`);
  lines.push(`Verdict: ${review.result.verdict}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(review.result.summary);

  if (review.result.findings.length > 0) {
    lines.push("");
    lines.push("## Findings");
    for (const finding of orderFindings(review.result.findings)) {
      const location = finding.file
        ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})`
        : "";
      lines.push(`- [${finding.severity}] ${finding.description}${location}`);
      if (finding.suggestedFix) {
        lines.push(`  fix: ${finding.suggestedFix}`);
      }
    }
  }

  if (review.result.strengths.length > 0) {
    lines.push("");
    lines.push("## Strengths");
    for (const strength of review.result.strengths) {
      lines.push(`- ${strength}`);
    }
  }

  lines.push("");
  lines.push("## Scope");
  lines.push(`Repository: ${review.input.repoRoot}`);
  lines.push(`Changed files reviewed: ${review.input.changedFiles.length}`);
  for (const file of review.input.changedFiles) {
    lines.push(`- ${file.status} ${file.path}`);
  }

  return lines.join("\n");
}

async function reviewWithModel(config: OpenMythosConfig, input: ReviewInput): Promise<ReviewResult> {
  const adapters = new AdapterRegistry(config);
  const model = config.models.verifier;
  const snapshots = input.changedFiles
    .map((file) => `=== ${file.status} ${file.path} ===\n${file.content ?? "[deleted or unavailable]"}`)
    .join("\n\n");

  const request: AdapterRequest = {
    system: REVIEW_SYSTEM,
    maxTokens: model.maxTokens,
    temperature: model.temperature,
    json: true,
    messages: [{
      role: "user",
      content: [
        "Review the current local repository changes.",
        "",
        "Git status:",
        input.statusText || "[clean status output]",
        "",
        "Git diff:",
        input.diff || "[no tracked diff output]",
        "",
        "Current file snapshots:",
        snapshots || "[no file snapshots available]"
      ].join("\n")
    }]
  };

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await adapters.call("verifier", attempt === 1
      ? request
      : {
          ...request,
          messages: [
            ...request.messages,
            {
              role: "user",
              content: "The previous response was rejected. Return only one complete valid JSON object that matches the required schema."
            }
          ]
        });

    try {
      return reviewSchema.parse(parseJsonFromModel(response.content));
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw new Error(`Review output failed validation: ${lastError?.message ?? "unknown error"}`);
}

async function gitRepoRoot(workdir: string, timeoutMs: number): Promise<string> {
  const result = await executeCommand("git", ["rev-parse", "--show-toplevel"], workdir, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`Not inside a git repository: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function buildDiffArgs(options: ReviewCliOptions): string[] {
  const args = ["diff", "--no-ext-diff", "--unified=3"];
  if (options.cached && !options.base && !options.head) {
    args.push("--cached");
  }
  if (options.base) {
    args.push(options.base);
  }
  if (options.head) {
    args.push(options.head);
  }
  return args;
}

async function collectChangedFiles(
  repoRoot: string,
  changed: Array<{ status: string; path: string }>,
  maxFileBytes: number
): Promise<ChangedFileSnapshot[]> {
  const snapshots: ChangedFileSnapshot[] = [];
  for (const file of changed) {
    let content: string | null = null;
    if (!file.status.startsWith("D")) {
      try {
        const text = await readRelativeFile(repoRoot, file.path);
        content = text.length > maxFileBytes
          ? `${text.slice(0, maxFileBytes)}\n...[truncated by harness review input]`
          : text;
      } catch {
        content = null;
      }
    }
    snapshots.push({ ...file, content });
  }
  return snapshots;
}

function mergeChangedFiles(statusText: string, nameStatusText: string): Array<{ status: string; path: string }> {
  const merged = new Map<string, { status: string; path: string }>();

  for (const file of parseNameStatus(nameStatusText)) {
    merged.set(file.path, file);
  }

  for (const file of parseStatusShort(statusText)) {
    if (!merged.has(file.path)) {
      merged.set(file.path, file);
    }
  }

  return [...merged.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function parseNameStatus(text: string): Array<{ status: string; path: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t").filter(Boolean);
      const status = parts[0]?.trim() || "M";
      const path = parts.length > 1
        ? parts[parts.length - 1] ?? ""
        : status.includes(" ")
          ? status.split(/\s+/).slice(1).join(" ")
          : "";
      return {
        status: status.split(/\s+/)[0] ?? "M",
        path
      };
    })
    .filter((file) => file.path.length > 0);
}

function parseStatusShort(text: string): Array<{ status: string; path: string }> {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || "M";
      const path = line.slice(3).trim().split(" -> ").at(-1) ?? "";
      return { status, path };
    })
    .filter((file) => file.path.length > 0);
}

function orderFindings(findings: QaIssue[]): QaIssue[] {
  const rank: Record<QaIssue["severity"], number> = {
    critical: 0,
    major: 1,
    minor: 2
  };
  return [...findings].sort((left, right) => {
    const severity = rank[left.severity] - rank[right.severity];
    if (severity !== 0) {
      return severity;
    }
    return `${left.file ?? ""}:${left.line ?? 0}:${left.description}`.localeCompare(
      `${right.file ?? ""}:${right.line ?? 0}:${right.description}`
    );
  });
}
