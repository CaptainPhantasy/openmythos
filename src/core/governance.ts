import { executeCommand } from "../tools/shell.js";
import type { OpenMythosConfig } from "../config/schema.js";

export interface GovernanceIssue {
  severity: "warning" | "error";
  code: "git_required" | "dirty_worktree" | "protected_branch";
  message: string;
}

export interface GovernanceReport {
  repoRoot: string | null;
  branch: string | null;
  isGitRepo: boolean;
  dirty: boolean;
  statusText: string;
  blocked: boolean;
  issues: GovernanceIssue[];
}

export class GovernanceViolationError extends Error {
  constructor(readonly report: GovernanceReport) {
    super(buildGovernanceMessage(report));
  }
}

export async function evaluateGovernance(
  config: OpenMythosConfig,
  workdir: string
): Promise<GovernanceReport> {
  const repoRootResult = await executeCommand("git", ["rev-parse", "--show-toplevel"], workdir, config.execution.timeoutMs);
  if (repoRootResult.exitCode !== 0) {
    const issue = config.governance.requireGitRepo
      ? [{
          severity: "error" as const,
          code: "git_required" as const,
          message: "Governance requires a git repository, but the working directory is not inside one."
        }]
      : [];
    return {
      repoRoot: null,
      branch: null,
      isGitRepo: false,
      dirty: false,
      statusText: "",
      blocked: issue.length > 0,
      issues: issue
    };
  }

  const repoRoot = repoRootResult.stdout.trim();
  const [branchResult, statusResult] = await Promise.all([
    executeCommand("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], repoRoot, config.execution.timeoutMs),
    executeCommand("git", ["status", "--short", "--untracked-files=all"], repoRoot, config.execution.timeoutMs)
  ]);

  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : null;
  const statusText = statusResult.exitCode === 0 ? statusResult.stdout.trim() : "";
  const dirty = statusText.length > 0;
  const issues: GovernanceIssue[] = [];

  if (dirty && config.governance.dirtyWorktree !== "allow") {
    issues.push({
      severity: config.governance.dirtyWorktree === "block" ? "error" : "warning",
      code: "dirty_worktree",
      message: "Working tree has local changes before the harness run starts."
    });
  }

  if (branch && config.governance.protectedBranches.some((pattern) => matchPattern(branch, pattern)) && config.governance.protectedBranchMode !== "allow") {
    issues.push({
      severity: config.governance.protectedBranchMode === "block" ? "error" : "warning",
      code: "protected_branch",
      message: `Current branch "${branch}" matches the protected branch policy.`
    });
  }

  return {
    repoRoot,
    branch,
    isGitRepo: true,
    dirty,
    statusText,
    blocked: issues.some((issue) => issue.severity === "error"),
    issues
  };
}

function matchPattern(value: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return value === pattern;
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function buildGovernanceMessage(report: GovernanceReport): string {
  return report.issues.map((issue) => issue.message).join(" ");
}
