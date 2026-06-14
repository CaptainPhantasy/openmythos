import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { executeCommand, type ShellResult } from "../tools/shell.js";
import type { PullRequestCheck, PullRequestContext, PullRequestVerification } from "./types.js";

export interface ResolvedPullRequest {
  pullRequest: PullRequestContext;
  goal: string;
  verification: PullRequestVerification;
}

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
) => Promise<ShellResult>;

export async function resolvePullRequestSource(
  source: string,
  workdir: string,
  timeoutMs: number,
  runCommand: CommandRunner = executeCommand
): Promise<ResolvedPullRequest> {
  const pullRequest = looksLikeFileSource(source, workdir)
    ? await resolveLocalPullRequest(source, workdir)
    : await resolveGithubPullRequest(source, workdir, timeoutMs, runCommand);

  return {
    pullRequest,
    goal: buildGoalFromPullRequest(pullRequest),
    verification: summarizePullRequestVerification(pullRequest)
  };
}

export function buildGoalFromPullRequest(pullRequest: PullRequestContext): string {
  const lines = [
    `Resolve pull request: ${pullRequest.title}`,
    pullRequest.body.trim()
  ].filter(Boolean);

  const metadata: string[] = [];
  if (pullRequest.baseRefName || pullRequest.headRefName) {
    metadata.push(`Branch flow: ${pullRequest.headRefName ?? "unknown"} -> ${pullRequest.baseRefName ?? "unknown"}`);
  }
  if (pullRequest.reviewDecision) {
    metadata.push(`Review decision: ${pullRequest.reviewDecision}`);
  }
  if (pullRequest.labels.length > 0) {
    metadata.push(`Labels: ${pullRequest.labels.join(", ")}`);
  }
  if (metadata.length > 0) {
    lines.push(metadata.join("\n"));
  }

  return lines.join("\n\n");
}

export function summarizePullRequestVerification(pullRequest: PullRequestContext): PullRequestVerification {
  if (pullRequest.source !== "github" || pullRequest.checks.length === 0) {
    return {
      status: "warning",
      summary: "No external pull-request check evidence is available.",
      passed: null,
      failingChecks: [],
      nextActions: ["Run `openmythos verify-pr <source>` against a GitHub-backed pull request to collect check results."],
      artifacts: [],
      checks: pullRequest.checks
    };
  }

  const failingChecks = pullRequest.checks
    .filter((check) => isFailingCheck(check))
    .map((check) => check.name);
  const pendingChecks = pullRequest.checks
    .filter((check) => isPendingCheck(check))
    .map((check) => check.name);

  if (failingChecks.length > 0) {
    return {
      status: "error",
      summary: `External pull-request checks failing: ${failingChecks.join(", ")}`,
      passed: false,
      failingChecks,
      nextActions: ["Inspect the failing GitHub checks before trusting the current branch state."],
      artifacts: [],
      checks: pullRequest.checks
    };
  }

  if (pendingChecks.length > 0) {
    return {
      status: "warning",
      summary: `External pull-request checks pending: ${pendingChecks.join(", ")}`,
      passed: null,
      failingChecks: [],
      nextActions: ["Wait for pending GitHub checks to complete and re-run verification."],
      artifacts: [],
      checks: pullRequest.checks
    };
  }

  return {
    status: "success",
    summary: "All available external pull-request checks are passing.",
    passed: true,
    failingChecks: [],
    nextActions: [],
    artifacts: [],
    checks: pullRequest.checks
  };
}

async function resolveLocalPullRequest(source: string, workdir: string): Promise<PullRequestContext> {
  const path = resolve(workdir, source);
  const raw = await readFile(path, "utf8");
  return path.endsWith(".json")
    ? parseJsonPullRequest(source, raw)
    : parseMarkdownPullRequest(source, raw);
}

async function resolveGithubPullRequest(
  source: string,
  workdir: string,
  timeoutMs: number,
  runCommand: CommandRunner
): Promise<PullRequestContext> {
  const ref = parsePullRequestReference(source);
  const args = [
    "pr",
    "view",
    String(ref.number),
    "--json",
    "number,title,body,labels,url,state,author,baseRefName,headRefName,reviewDecision,isDraft,statusCheckRollup"
  ];
  if (ref.repo) {
    args.splice(2, 0, "--repo", ref.repo);
  }

  const result = await runCommand("gh", args, workdir, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to resolve GitHub pull request ${source}: ${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout) as {
    number: number;
    title: string;
    body?: string;
    url?: string;
    state?: string;
    labels?: Array<{ name?: string }>;
    author?: { login?: string };
    baseRefName?: string;
    headRefName?: string;
    reviewDecision?: string;
    isDraft?: boolean;
    statusCheckRollup?: unknown[];
  };

  return {
    source: "github",
    reference: source,
    title: parsed.title,
    body: parsed.body ?? "",
    labels: (parsed.labels ?? []).map((label) => label.name).filter((label): label is string => Boolean(label)),
    checks: parseStatusChecks(parsed.statusCheckRollup),
    number: parsed.number,
    ...(parsed.url ? { url: parsed.url } : {}),
    ...(ref.repo ? { repository: ref.repo } : {}),
    ...(parsed.state ? { state: parsed.state } : {}),
    ...(parsed.author?.login ? { author: parsed.author.login } : {}),
    ...(parsed.baseRefName ? { baseRefName: parsed.baseRefName } : {}),
    ...(parsed.headRefName ? { headRefName: parsed.headRefName } : {}),
    ...(parsed.reviewDecision ? { reviewDecision: parsed.reviewDecision } : {}),
    ...(typeof parsed.isDraft === "boolean" ? { isDraft: parsed.isDraft } : {})
  };
}

function looksLikeFileSource(source: string, workdir: string): boolean {
  if (source.includes("/") || source.endsWith(".md") || source.endsWith(".markdown") || source.endsWith(".json")) {
    return existsSync(resolve(workdir, source));
  }
  return false;
}

function parseMarkdownPullRequest(reference: string, raw: string): PullRequestContext {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  const titleLine = lines.find((line) => line.trim().startsWith("# ")) ?? lines.find((line) => line.trim().length > 0) ?? "Untitled pull request";
  const title = titleLine.replace(/^#+\s*/, "").trim();
  const titleIndex = lines.indexOf(titleLine);
  const body = lines.filter((_, index) => index !== titleIndex).join("\n").trim();

  return {
    source: "local-file",
    reference,
    title,
    body,
    labels: [],
    checks: []
  };
}

function parseJsonPullRequest(reference: string, raw: string): PullRequestContext {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const title = typeof parsed.title === "string"
    ? parsed.title
    : typeof parsed.summary === "string"
      ? parsed.summary
      : "Untitled pull request";
  const body = typeof parsed.body === "string"
    ? parsed.body
    : typeof parsed.description === "string"
      ? parsed.description
      : "";
  const labels = Array.isArray(parsed.labels)
    ? parsed.labels.filter((label): label is string => typeof label === "string")
    : [];

  return {
    source: "local-file",
    reference,
    title,
    body,
    labels,
    checks: Array.isArray(parsed.checks) ? parseStatusChecks(parsed.checks) : [],
    ...(typeof parsed.url === "string" ? { url: parsed.url } : {}),
    ...(typeof parsed.number === "number" ? { number: parsed.number } : {}),
    ...(typeof parsed.repository === "string" ? { repository: parsed.repository } : {}),
    ...(typeof parsed.state === "string" ? { state: parsed.state } : {}),
    ...(typeof parsed.author === "string" ? { author: parsed.author } : {}),
    ...(typeof parsed.baseRefName === "string" ? { baseRefName: parsed.baseRefName } : {}),
    ...(typeof parsed.headRefName === "string" ? { headRefName: parsed.headRefName } : {}),
    ...(typeof parsed.reviewDecision === "string" ? { reviewDecision: parsed.reviewDecision } : {}),
    ...(typeof parsed.isDraft === "boolean" ? { isDraft: parsed.isDraft } : {})
  };
}

function parsePullRequestReference(source: string): { repo?: string; number: number } {
  const trimmed = source.trim();
  const urlMatch = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:\/.*)?$/i.exec(trimmed);
  if (urlMatch) {
    return {
      ...(urlMatch[1] ? { repo: urlMatch[1] } : {}),
      number: Number.parseInt(urlMatch[2] ?? "0", 10)
    };
  }

  const repoRefMatch = /^([^/\s]+\/[^#\s]+)#(\d+)$/.exec(trimmed);
  if (repoRefMatch) {
    return {
      ...(repoRefMatch[1] ? { repo: repoRefMatch[1] } : {}),
      number: Number.parseInt(repoRefMatch[2] ?? "0", 10)
    };
  }

  const plainNumber = Number.parseInt(trimmed, 10);
  if (Number.isInteger(plainNumber) && plainNumber > 0) {
    return { number: plainNumber };
  }

  throw new Error(`Unsupported pull request reference: ${source}`);
}

function parseStatusChecks(rawChecks: unknown): PullRequestCheck[] {
  if (!Array.isArray(rawChecks)) {
    return [];
  }

  return rawChecks.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string"
      ? record.name
      : typeof record.context === "string"
        ? record.context
        : typeof record.title === "string"
          ? record.title
          : "unnamed-check";
    const status = typeof record.status === "string" ? record.status : "UNKNOWN";
    const conclusion = typeof record.conclusion === "string"
      ? record.conclusion
      : status;

    return [{
      name,
      status,
      conclusion,
      ...(typeof record.detailsUrl === "string" ? { detailsUrl: record.detailsUrl } : {}),
      ...(typeof record.workflowName === "string" ? { workflow: record.workflowName } : {})
    }];
  });
}

function isFailingCheck(check: PullRequestCheck): boolean {
  const value = `${check.status}:${check.conclusion}`.toUpperCase();
  return ["FAIL", "ERROR", "CANCEL", "TIMED_OUT", "ACTION_REQUIRED"].some((token) => value.includes(token));
}

function isPendingCheck(check: PullRequestCheck): boolean {
  const value = `${check.status}:${check.conclusion}`.toUpperCase();
  return ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "STARTUP_FAILURE", "EXPECTED"].some((token) => value.includes(token));
}
