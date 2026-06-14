import type { HarnessAction, Plan, PlanTask } from "./types.js";

export interface ToolDefinition {
  id: string;
  description: string;
  roles: PlanTask["role"][];
}

export interface ToolValidationIssue {
  taskId: string;
  tool: string;
  normalizedTool?: string;
  reason: "unsupported" | "role_mismatch" | "executor_mismatch" | "action_mismatch";
  role: PlanTask["role"];
}

export interface HarnessActionDefinition {
  id: HarnessAction;
  description: string;
  allowedTools: string[];
}

const toolCatalog: ToolDefinition[] = [
  {
    id: "filesystem.read",
    description: "Read repository files and gather local file context.",
    roles: ["coder", "critic", "verifier"]
  },
  {
    id: "filesystem.search",
    description: "Search repository text with deterministic fixed-string queries.",
    roles: ["coder", "critic", "verifier"]
  },
  {
    id: "code.symbols",
    description: "Locate likely symbol definitions from explicit identifier queries.",
    roles: ["coder", "critic", "verifier"]
  },
  {
    id: "filesystem.write",
    description: "Create or fully rewrite files.",
    roles: ["coder", "critic"]
  },
  {
    id: "filesystem.patch",
    description: "Apply unified-diff patch edits to existing files.",
    roles: ["coder", "critic"]
  },
  {
    id: "shell.run",
    description: "Run local shell commands inside the repository.",
    roles: ["coder", "verifier"]
  },
  {
    id: "verification.command",
    description: "Run deterministic command-based verification checks.",
    roles: ["coder", "critic", "verifier"]
  },
  {
    id: "review.inspect",
    description: "Inspect diffs, changed files, and review artifacts.",
    roles: ["critic", "verifier"]
  },
  {
    id: "git.status",
    description: "Inspect branch, dirty-worktree, and status information.",
    roles: ["coder", "critic", "verifier"]
  },
  {
    id: "git.diff",
    description: "Inspect repository diffs for review or verification.",
    roles: ["critic", "verifier"]
  },
  {
    id: "git.issue_view",
    description: "Resolve issue-backed workflow inputs from GitHub.",
    roles: ["verifier"]
  },
  {
    id: "git.pr_view",
    description: "Resolve pull-request-backed workflow inputs and external checks.",
    roles: ["verifier"]
  }
];

const harnessActionCatalog: HarnessActionDefinition[] = [
  {
    id: "verify.file_state",
    description: "Read targeted files and verify their current repository state.",
    allowedTools: ["filesystem.read", "verification.command"]
  },
  {
    id: "verify.git_status",
    description: "Inspect branch and dirty-worktree state before proceeding.",
    allowedTools: ["git.status", "verification.command"]
  },
  {
    id: "verify.git_diff",
    description: "Inspect repository diffs and review-oriented change state.",
    allowedTools: ["git.diff", "review.inspect", "verification.command"]
  },
  {
    id: "verify.issue_context",
    description: "Read issue-backed workflow context retained by the harness.",
    allowedTools: ["git.issue_view", "verification.command"]
  },
  {
    id: "verify.pr_context",
    description: "Read pull request context retained by the harness.",
    allowedTools: ["git.pr_view", "verification.command"]
  },
  {
    id: "verify.pr_checks",
    description: "Inspect retained pull request check and verification state.",
    allowedTools: ["git.pr_view", "verification.command"]
  }
];

const aliasMap: Record<string, string> = {
  bash: "shell.run",
  shell: "shell.run",
  command: "shell.run",
  commands: "shell.run",
  test: "verification.command",
  verify: "verification.command",
  verification: "verification.command",
  review: "review.inspect",
  diff: "git.diff",
  "git.read": "git.status",
  "git.branch": "git.status",
  "git.pr": "git.pr_view",
  "git.pull_request": "git.pr_view",
  "git.issue": "git.issue_view",
  read: "filesystem.read",
  search: "filesystem.search",
  grep: "filesystem.search",
  symbols: "code.symbols",
  symbol: "code.symbols",
  write: "filesystem.write",
  modify: "filesystem.write",
  patch: "filesystem.patch",
  "filesystem.modify": "filesystem.write",
  "filesystem.edit": "filesystem.write",
  "filesystem.read_file": "filesystem.read",
  "filesystem.write_file": "filesystem.write"
};

const catalogById = new Map(toolCatalog.map((tool) => [tool.id, tool]));
const harnessActionById = new Map(harnessActionCatalog.map((action) => [action.id, action]));
const harnessOnlyTools = new Set([
  "filesystem.read",
  "verification.command",
  "review.inspect",
  "git.status",
  "git.diff",
  "git.issue_view",
  "git.pr_view"
]);

export function supportedTools(): ToolDefinition[] {
  return toolCatalog.map((tool) => ({ ...tool, roles: [...tool.roles] }));
}

export function supportedHarnessActions(): HarnessActionDefinition[] {
  return harnessActionCatalog.map((action) => ({
    ...action,
    allowedTools: [...action.allowedTools]
  }));
}

export function formatToolCatalogForPrompt(): string {
  return toolCatalog
    .map((tool) => `- ${tool.id}: ${tool.description} Allowed roles: ${tool.roles.join(", ")}`)
    .join("\n");
}

export function formatHarnessActionCatalogForPrompt(): string {
  return harnessActionCatalog
    .map((action) => `- ${action.id}: ${action.description} Allowed tools: ${action.allowedTools.join(", ")}`)
    .join("\n");
}

export function normalizePlanTools(plan: Plan): { plan: Plan; issues: ToolValidationIssue[] } {
  const issues: ToolValidationIssue[] = [];
  const tasks = plan.tasks.map((task) => {
    const normalizedTools = task.requiredTools.flatMap((tool) => {
      const normalized = normalizeToolId(tool);
      const definition = catalogById.get(normalized);
      if (!definition) {
        issues.push({
          taskId: task.id,
          tool,
          ...(normalized !== tool ? { normalizedTool: normalized } : {}),
          reason: "unsupported",
          role: task.role
        });
        return [];
      }
      if (!definition.roles.includes(task.role)) {
        issues.push({
          taskId: task.id,
          tool,
          ...(normalized !== tool ? { normalizedTool: normalized } : {}),
          reason: "role_mismatch",
          role: task.role
        });
        return [];
      }
      return [normalized];
    });

    return {
      ...task,
      requiredTools: [...new Set(normalizedTools)]
    };
  });

  for (const task of tasks) {
    if (task.executor !== "harness") {
      if (task.harnessAction !== null) {
        issues.push({
          taskId: task.id,
          tool: `harnessAction:${task.harnessAction}`,
          reason: "action_mismatch",
          role: task.role
        });
      }
      continue;
    }
    if (task.role !== "verifier") {
      issues.push({
        taskId: task.id,
        tool: "executor:harness",
        reason: "executor_mismatch",
        role: task.role
      });
    }
    if (task.harnessAction === null) {
      issues.push({
        taskId: task.id,
        tool: "harnessAction",
        reason: "action_mismatch",
        role: task.role
      });
      continue;
    }
    const harnessAction = harnessActionById.get(task.harnessAction);
    if (!harnessAction) {
      issues.push({
        taskId: task.id,
        tool: `harnessAction:${task.harnessAction}`,
        reason: "action_mismatch",
        role: task.role
      });
      continue;
    }
    if (task.verificationCommands.length === 0) {
      issues.push({
        taskId: task.id,
        tool: "verificationCommands",
        reason: "executor_mismatch",
        role: task.role
      });
    }
    for (const tool of task.requiredTools) {
      if (!harnessOnlyTools.has(tool)) {
        issues.push({
          taskId: task.id,
          tool,
          reason: "executor_mismatch",
          role: task.role
        });
        continue;
      }
      if (!harnessAction.allowedTools.includes(tool)) {
        issues.push({
          taskId: task.id,
          tool,
          reason: "action_mismatch",
          role: task.role
        });
      }
    }
  }

  return {
    plan: {
      ...plan,
      tasks
    },
    issues
  };
}

export function summarizeToolValidationIssues(issues: ToolValidationIssue[]): string {
  return issues.map((issue) => {
    const normalized = issue.normalizedTool && issue.normalizedTool !== issue.tool
      ? ` (normalized candidate: ${issue.normalizedTool})`
      : "";
    return `${issue.taskId}: ${issue.tool}${normalized} -> ${issue.reason} for role ${issue.role}`;
  }).join("\n");
}

function normalizeToolId(tool: string): string {
  const trimmed = tool.trim().toLowerCase();
  return aliasMap[trimmed] ?? trimmed;
}
