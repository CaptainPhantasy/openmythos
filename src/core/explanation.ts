/**
 * Human-readable explanations for harness decision-making.
 *
 * This module surfaces the rationale behind worker routing, tool selection,
 * and action paths to the human operator. All functions are pure — they take
 * structured inputs and return plain text explanations without side effects.
 */

/**
 * Explain why a plan was structured the way it was.
 *
 * Analyzes the task distribution by role, identifies parallel vs sequential
 * groups, and highlights dependency chains that shaped the plan.
 */
export function explainPlan(
  plan: {
    tasks: Array<{
      id: string;
      role: string;
      description: string;
      tools: string[];
      dependsOn?: string[];
    }>;
    strategy?: string;
  }
): { summary: string; details: string[]; recommendations: string[] } {
  if (plan.tasks.length === 0) {
    return {
      summary: "No tasks defined in this plan.",
      details: [],
      recommendations: [],
    };
  }

  // Count tasks by role
  const roleCounts: Record<string, number> = {};
  for (const task of plan.tasks) {
    roleCounts[task.role] = (roleCounts[task.role] || 0) + 1;
  }

  const roleSummary = Object.entries(roleCounts)
    .map(([role, count]) => `${role}: ${count}`)
    .join(", ");

  // Identify parallel vs serial groups
  const parallelGroups: string[] = [];
  const serialGroups: string[] = [];

  for (const task of plan.tasks) {
    if (!task.dependsOn?.length) {
      parallelGroups.push(task.id);
    } else {
      serialGroups.push(task.id);
    }
  }

  // Build details
  const details: string[] = [];

  if (plan.strategy) {
    details.push(`Strategy: ${plan.strategy}`);
  }

  details.push(
    `Task distribution: ${roleSummary}`
  );

  if (parallelGroups.length > 0) {
    details.push(
      `Parallel tasks: ${parallelGroups.join(", ")} (can run concurrently)`
    );
  }

  if (serialGroups.length > 0) {
    details.push(
      `Serial tasks: ${serialGroups.join(", ")} (must run sequentially)`
    );
  }

  if (plan.tasks.some((t) => t.dependsOn?.length)) {
    const chains: string[] = [];
    for (const task of plan.tasks) {
      if (task.dependsOn?.length) {
        chains.push(`${task.id} depends on [${task.dependsOn.join(", ")}]`);
      }
    }
    details.push(`Dependency chains: ${chains.join("; ")}`);
  }

  // Build recommendations
  const recommendations: string[] = [];

  if (roleCounts.coder && roleCounts.critic && roleCounts.verifier) {
    recommendations.push(
      "Task decomposition covers implementation, review, and verification — consider merging if you only need implementation."
    );
  }

  if (parallelGroups.length > 1) {
    recommendations.push(
      "Parallel tasks share no dependencies — execution order won't affect correctness."
    );
  }

  if (serialGroups.length > 1) {
    recommendations.push(
      "Serial tasks have dependencies — changing order may introduce blocking or new constraints."
    );
  }

  return {
    summary: `Plan structures ${plan.tasks.length} tasks into ${parallelGroups.length} parallel group(s) and ${serialGroups.length} serial group(s).`,
    details,
    recommendations,
  };
}

/**
 * Explain why a specific task was routed to a specific worker role.
 *
 * Matches role to known responsibilities and explains why that role fits the
 * task description and tool set.
 */
export function explainTaskRouting(
  task: {
    role: string;
    description: string;
    tools: string[];
  },
  decision?: {
    role: string;
    reason: string;
  }
): {
  role: string;
  rationale: string;
  alternatives: string[];
} {
  const roleResponsibilities: Record<string, string[]> = {
    coder: [
      "Implementation of new features",
      "Bug fixes and code changes",
      "Writing or modifying code files",
      "Refactoring existing code",
    ],
    critic: [
      "Code review and quality analysis",
      "Identifying security vulnerabilities",
      "Performance and maintainability checks",
      "Ensuring requirements alignment",
    ],
    verifier: [
      "Running tests and verification commands",
      "Checking build output",
      "Validating acceptance criteria",
      "Confirmation steps before completion",
    ],
  };

  const roleInfo =
    roleResponsibilities[task.role] || [
      `Custom role: ${task.role}`,
      "Task-specific responsibilities",
    ];

  const rationale = `Task "${task.description}" routed to ${task.role} because: ${roleInfo.join(", ")}.`;

  // Generate alternatives based on task characteristics
  const alternatives: string[] = [];

  if (task.tools.some((t) => t.includes("shell"))) {
    alternatives.push(
      `Alternative: verifier (tools like [${task.tools.join(", ")}] are verification-compatible)`
    );
  }

  if (task.tools.some((t) => t.includes("editor") || t.includes("patch"))) {
    alternatives.push(
      `Alternative: coder (tools like [${task.tools.join(", ")}] perform code modifications)`
    );
  }

  if (task.tools.some((t) => t.includes("read") || t.includes("search"))) {
    alternatives.push(
      `Alternative: critic (tools like [${task.tools.join(", ")}] gather context for review)`
    );
  }

  if (!alternatives.length) {
    alternatives.push("No clear alternative role identified for this task.");
  }

  if (decision?.reason) {
    alternatives.unshift(decision.reason);
  }

  return {
    role: task.role,
    rationale,
    alternatives,
  };
}

/**
 * Explain why a specific tool was chosen for a task.
 *
 * Maps each tool to its purpose and suggests safer alternatives where
 * applicable.
 */
export function explainToolChoice(
  tool: string,
  context: {
    taskType?: string;
    fileType?: string;
    operation?: string;
  }
): {
  tool: string;
  reason: string;
  saferAlternative?: string;
} {
  const toolPurpose: Record<string, string> = {
    filesystem_read: "Reading files to gather context and understand current state",
    filesystem_write: "Creating or modifying files on disk",
    filesystem_patch: "Surgically applying code changes with diff-based patches",
    filesystem_move: "Renaming, moving, or reorganizing files and directories",
    filesystem_copy: "Copying files and directories",
    filesystem_delete: "Removing files and directories safely",
    shell_run: "Executing shell commands to perform operations",
    shell_interactive: "Running interactive shell sessions",
    shell_script: "Executing script files or command sequences",
    ast_parse: "Parsing code structure for syntax analysis",
    ast_edit: "Applying AST-based structural code transformations",
    ast_grep: "Searching code using syntax-aware patterns",
    git_diff: "Comparing file changes for review and validation",
    git_status: "Checking repository state and staged changes",
    git_commit: "Creating git commits with message generation",
    git_push: "Pushing commits to remote repositories",
    git_fetch: "Fetching remote branch information",
    web_search: "Searching the web for external information and documentation",
    web_fetch: "Fetching and parsing web content directly",
    http_request: "Making HTTP requests to external APIs",
    database_query: "Running database queries against data stores",
    database_schema: "Inspecting and validating database schema",
    linter_run: "Running linting and formatting tools",
    test_run: "Executing test suites",
    test_coverage: "Generating and analyzing test coverage reports",
  };

  const purpose = toolPurpose[tool] || `Purpose: ${tool}`;

  const reason = `Tool [${tool}] chosen for: ${purpose}`;

  // Safer alternatives
  const saferAlternatives: Record<string, string> = {
    filesystem_patch: "filesystem_write (patch is surgical but write handles edge cases)",
    filesystem_write: "filesystem_patch (patch preserves context, write is direct)",
    shell_run: "shell_script (script is more structured and versionable)",
    shell_interactive: "shell_script (script is more structured and versionable)",
    shell_script: "shell_run (run is simpler for single commands)",
    ast_edit: "ast_grep (grep is more forgiving, edit requires valid syntax)",
    ast_grep: "ast_parse (parse is read-only, grep can find any text)",
  };

  const result: { tool: string; reason: string; saferAlternative?: string } = {
    tool,
    reason,
  };
  const alt = saferAlternatives[tool];
  if (alt) {
    result.saferAlternative = alt;
  }
  return result;
}

/**
 * Explain verification results in human terms.
 *
 * Summarizes pass/fail, computes confidence level, and highlights any
 * skipped or inconclusive results.
 */
export function explainVerification(
  presets: string[],
  results: Array<{
    preset: string;
    passed: boolean;
    output?: string;
  }>
): {
  summary: string;
  passed: string[];
  failed: string[];
  skipped: string[];
  confidence: string;
} {
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  const skipped = presets.filter((p) => !results.find((r) => r.preset === p));

  const confidence =
    failed.length === 0 && passed.length === presets.length
      ? "high"
      : failed.length === 0
      ? "medium"
      : "low";

  const summary = `${passed.length}/${presets.length} checks passed. ${failed.length} failed. ${skipped.length} skipped.`;

  return {
    summary,
    passed: passed.map((r) => r.preset),
    failed: failed.map((r) => r.preset),
    skipped,
    confidence,
  };
}

/**
 * Explain a risk assessment for an edit or action.
 *
 * Interprets risk level (low/medium/high) and identifies what action is
 * required based on the severity.
 */
export function explainRisk(
  risk: {
    level: string;
    findings: Array<{
      type: string;
      severity: string;
      description: string;
    }>;
  }
): {
  level: string;
  summary: string;
  actionRequired: string;
  details: string[];
} {
  const level = risk.level.toLowerCase();

  let actionRequired = "";
  let summary = "";

  if (level === "high") {
    actionRequired =
      "⚠️ CRITICAL — requires explicit approval before proceeding.";
    summary = "High-risk changes detected. Review findings carefully.";
  } else if (level === "medium") {
    actionRequired =
      "⚡ CAUTION — review recommended. Proceed with caution.";
    summary = "Medium-risk factors identified. Consider mitigation strategies.";
  } else {
    actionRequired = "✓ SAFE — no blocking issues detected.";
    summary = "No significant risks found. Proceeding automatically.";
  }

  const details = risk.findings.map((finding) =>
    `[${finding.severity}] ${finding.type}: ${finding.description}`
  );

  return {
    level: risk.level,
    summary,
    actionRequired,
    details,
  };
}

/**
 * Format an explanation for terminal display.
 *
 * Produces indented text with bullet points, suitable for console output.
 */
export function formatExplanation(
  explanation: {
    summary?: string;
    details?: string[];
    recommendations?: string[];
  },
  indent: number = 0
): string {
  const indentStr = "  ".repeat(indent);

  let output = "";

  if (explanation.summary) {
    output += `${indentStr}${explanation.summary}\n`;
  }

  if (explanation.details && explanation.details.length > 0) {
    output += `${indentStr}Details:\n`;
    for (const detail of explanation.details) {
      output += `${indentStr}  • ${detail}\n`;
    }
  }

  if (explanation.recommendations && explanation.recommendations.length > 0) {
    output += `${indentStr}Recommendations:\n`;
    for (const rec of explanation.recommendations) {
      output += `${indentStr}  • ${rec}\n`;
    }
  }

  return output.trimEnd();
}
