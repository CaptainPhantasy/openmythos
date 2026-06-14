import type { Plan, PlanTask } from "./types.js";

export interface ToolDefinition {
  id: string;
  description: string;
  roles: PlanTask["role"][];
}

export interface ToolValidationIssue {
  taskId: string;
  tool: string;
  normalizedTool?: string;
  reason: "unsupported" | "role_mismatch";
  role: PlanTask["role"];
}

const toolCatalog: ToolDefinition[] = [
  {
    id: "filesystem.read",
    description: "Read repository files and gather local file context.",
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
  write: "filesystem.write",
  modify: "filesystem.write",
  patch: "filesystem.patch",
  "filesystem.modify": "filesystem.write",
  "filesystem.edit": "filesystem.write",
  "filesystem.read_file": "filesystem.read",
  "filesystem.write_file": "filesystem.write"
};

const catalogById = new Map(toolCatalog.map((tool) => [tool.id, tool]));

export function supportedTools(): ToolDefinition[] {
  return toolCatalog.map((tool) => ({ ...tool, roles: [...tool.roles] }));
}

export function formatToolCatalogForPrompt(): string {
  return toolCatalog
    .map((tool) => `- ${tool.id}: ${tool.description} Allowed roles: ${tool.roles.join(", ")}`)
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
