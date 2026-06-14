import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { executeCommand, type ShellResult } from "../tools/shell.js";
import type { IssueContext } from "./types.js";

export interface ResolvedIssue {
  issue: IssueContext;
  goal: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
) => Promise<ShellResult>;

export async function resolveIssueSource(
  source: string,
  workdir: string,
  timeoutMs: number,
  runCommand: CommandRunner = executeCommand
): Promise<ResolvedIssue> {
  if (looksLikeFileSource(source, workdir)) {
    return resolveLocalIssue(source, workdir);
  }
  return resolveGithubIssue(source, workdir, timeoutMs, runCommand);
}

export function buildGoalFromIssue(issue: IssueContext): string {
  const lines = [
    `Resolve issue: ${issue.title}`,
    issue.body.trim()
  ].filter(Boolean);

  if (issue.labels.length > 0) {
    lines.push(`Labels: ${issue.labels.join(", ")}`);
  }

  return lines.join("\n\n");
}

async function resolveLocalIssue(source: string, workdir: string): Promise<ResolvedIssue> {
  const path = resolve(workdir, source);
  const raw = await readFile(path, "utf8");
  const issue = path.endsWith(".json")
    ? parseJsonIssue(source, raw)
    : parseMarkdownIssue(source, raw);
  return {
    issue,
    goal: buildGoalFromIssue(issue)
  };
}

async function resolveGithubIssue(
  source: string,
  workdir: string,
  timeoutMs: number,
  runCommand: CommandRunner
): Promise<ResolvedIssue> {
  const ref = parseGithubReference(source);
  const args = ["issue", "view", String(ref.number), "--json", "number,title,body,labels,url,state,author"];
  if (ref.repo) {
    args.splice(2, 0, "--repo", ref.repo);
  }

  const result = await runCommand("gh", args, workdir, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to resolve GitHub issue ${source}: ${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout) as {
    number: number;
    title: string;
    body?: string;
    url?: string;
    state?: string;
    labels?: Array<{ name?: string }>;
    author?: { login?: string };
  };

  const issue: IssueContext = {
    source: "github",
    reference: source,
    title: parsed.title,
    body: parsed.body ?? "",
    labels: (parsed.labels ?? []).map((label) => label.name).filter((label): label is string => Boolean(label)),
    number: parsed.number,
    ...(parsed.url ? { url: parsed.url } : {}),
    ...(ref.repo ? { repository: ref.repo } : {}),
    ...(parsed.state ? { state: parsed.state } : {}),
    ...(parsed.author?.login ? { author: parsed.author.login } : {})
  };

  return {
    issue,
    goal: buildGoalFromIssue(issue)
  };
}

function looksLikeFileSource(source: string, workdir: string): boolean {
  if (source.includes("/") || source.endsWith(".md") || source.endsWith(".markdown") || source.endsWith(".json")) {
    return existsSync(resolve(workdir, source));
  }
  return false;
}

function parseMarkdownIssue(reference: string, raw: string): IssueContext {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  const titleLine = lines.find((line) => line.trim().startsWith("# ")) ?? lines.find((line) => line.trim().length > 0) ?? "Untitled issue";
  const title = titleLine.replace(/^#+\s*/, "").trim();
  const titleIndex = lines.indexOf(titleLine);
  const body = lines
    .filter((_, index) => index !== titleIndex)
    .join("\n")
    .trim();

  return {
    source: "local-file",
    reference,
    title,
    body,
    labels: []
  };
}

function parseJsonIssue(reference: string, raw: string): IssueContext {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const title = typeof parsed.title === "string"
    ? parsed.title
    : typeof parsed.summary === "string"
      ? parsed.summary
      : "Untitled issue";
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
    ...(typeof parsed.url === "string" ? { url: parsed.url } : {}),
    ...(typeof parsed.number === "number" ? { number: parsed.number } : {}),
    ...(typeof parsed.repository === "string" ? { repository: parsed.repository } : {}),
    ...(typeof parsed.state === "string" ? { state: parsed.state } : {}),
    ...(typeof parsed.author === "string" ? { author: parsed.author } : {})
  };
}

function parseGithubReference(source: string): { repo?: string; number: number } {
  const trimmed = source.trim();
  const urlMatch = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)(?:\/.*)?$/i.exec(trimmed);
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

  throw new Error(`Unsupported issue reference: ${source}`);
}
