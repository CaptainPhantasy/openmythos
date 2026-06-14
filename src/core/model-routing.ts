/**
 * Model routing policies for task-based model selection.
 *
 * Routes tasks to appropriate model roles based on complexity, latency, cost,
 * and risk considerations. Supports flexible policy matching with fallback chains.
 */

export type TaskComplexity = "trivial" | "standard" | "complex" | "research";
export type RiskLevel = "safe" | "moderate" | "high" | "critical";

export interface RoutingPolicy {
  /** Task type pattern to match (e.g. "bugfix", "feature", "refactor", "test", "docs") */
  taskType: string;
  /** Preferred model role from config (e.g. "coder", "critic", "planner") */
  preferredRole: string;
  /** Fallback role if preferred is unavailable */
  fallbackRole?: string;
  /** Maximum acceptable latency in ms */
  maxLatencyMs?: number;
  /** Maximum acceptable cost per request in cents */
  maxCostCents?: number;
  /** Required risk level to handle (tasks above this are routed elsewhere) */
  maxRiskLevel?: RiskLevel;
  /** Whether this policy allows tool use */
  allowTools?: boolean;
}

export interface RoutingDecision {
  role: string;
  reason: string;
  policy: RoutingPolicy;
  alternatives: string[];
}

/**
 * Route a task to the best model role based on policies.
 *
 * @param task - Task metadata containing type, complexity, riskLevel, and tool requirements
 * @param policies - Available routing policies to consider
 * @returns Routing decision with selected role, reason, matched policy, and alternatives
 */
export function routeModel(
  task: { type: string; complexity: TaskComplexity; riskLevel: RiskLevel; requiresTools: boolean },
  policies: RoutingPolicy[]
): RoutingDecision {
  // Find best matching policy
  const matched = policies.find(p => p.taskType === task.type);

  if (matched) {
    const role = matched.preferredRole;
    const alternatives = policies
      .filter(p => p.taskType !== task.type && p.preferredRole === role)
      .map(p => p.taskType);
    
    return {
      role,
      reason: `Task type "${task.type}" matched policy with preferred role "${role}"`,
      policy: matched,
      alternatives
    };
  }

  // No direct match, fall back to preferred role of first policy
  const fallbackPolicy = policies[0];
  if (fallbackPolicy) {
    const role = fallbackPolicy.preferredRole;
    return {
      role,
      reason: `No policy for task type "${task.type}", falling back to preferred role "${role}" from "${fallbackPolicy.taskType}" policy`,
      policy: fallbackPolicy,
      alternatives: policies.filter(p => p.taskType !== fallbackPolicy.taskType).map(p => p.taskType)
    };
  }

  // No policies available, default to 'coder'
  return {
    role: "coder",
    reason: "No routing policies configured, defaulting to 'coder' role",
    policy: { taskType: "fallback", preferredRole: "coder" },
    alternatives: []
  };
}

/**
 * Default routing policies for common task types.
 *
 * @returns Array of routing policies covering typical workflows
 */
export function defaultRoutingPolicies(): RoutingPolicy[] {
  return [
    {
      taskType: "bugfix",
      preferredRole: "coder",
      maxLatencyMs: 5000,
      maxCostCents: 10,
      maxRiskLevel: "moderate"
    },
    {
      taskType: "feature",
      preferredRole: "coder",
      maxLatencyMs: 30000,
      maxCostCents: 50,
      maxRiskLevel: "moderate",
      allowTools: true
    },
    {
      taskType: "refactor",
      preferredRole: "coder",
      maxLatencyMs: 30000,
      maxCostCents: 50,
      maxRiskLevel: "safe"
    },
    {
      taskType: "test",
      preferredRole: "coder",
      maxLatencyMs: 10000,
      maxCostCents: 20,
      maxRiskLevel: "safe"
    },
    {
      taskType: "docs",
      preferredRole: "coder",
      maxLatencyMs: 5000,
      maxCostCents: 5,
      maxRiskLevel: "safe"
    },
    {
      taskType: "review",
      preferredRole: "critic",
      maxLatencyMs: 5000,
      maxCostCents: 10,
      maxRiskLevel: "safe"
    },
    {
      taskType: "security",
      preferredRole: "critic",
      maxLatencyMs: 30000,
      maxCostCents: 50,
      maxRiskLevel: "critical"
    },
    {
      taskType: "research",
      preferredRole: "planner",
      maxLatencyMs: 60000,
      maxCostCents: 100,
      maxRiskLevel: "safe"
    }
  ];
}

/**
 * Validate that a set of policies covers all task types without conflicts.
 *
 * @param policies - Policies to validate
 * @returns Validation result with validity flag and list of issues
 */
export function validatePolicies(policies: RoutingPolicy[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const taskTypeSet = new Set<string>();

  // Check for duplicate task types
  for (const policy of policies) {
    if (taskTypeSet.has(policy.taskType)) {
      issues.push(`Duplicate task type: "${policy.taskType}"`);
    } else {
      taskTypeSet.add(policy.taskType);
    }
  }

  // Check for missing preferred roles
  for (const policy of policies) {
    if (!policy.preferredRole || policy.preferredRole.trim() === "") {
      issues.push(`Policy with task type "${policy.taskType}" is missing preferredRole`);
    }
  }

  // Check for invalid risk levels
  const validRiskLevels: RiskLevel[] = ["safe", "moderate", "high", "critical"];
  for (const policy of policies) {
    if (policy.maxRiskLevel && !validRiskLevels.includes(policy.maxRiskLevel)) {
      issues.push(`Invalid risk level "${policy.maxRiskLevel}" in policy for task type "${policy.taskType}"`);
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Classify task complexity from description and size metadata.
 *
 * @param description - Task description text
 * @param fileCount - Number of files involved in the task
 * @param estimatedLOC - Estimated lines of code to modify
 * @returns Classified complexity level
 */
export function classifyComplexity(description: string, fileCount: number, estimatedLOC: number): TaskComplexity {
  if (estimatedLOC >= 2000 || fileCount > 5) return "research";
  if (estimatedLOC >= 500 || fileCount >= 3) return "complex";
  if (estimatedLOC < 50 && fileCount <= 1) return "trivial";
  return "standard";
}

/**
 * Classify risk level from task metadata.
 *
 * @param editableFiles - Number of files that will be edited
 * @param destructiveOps - Whether task involves destructive operations (e.g. delete)
 * @param touchSecrets - Whether task involves secrets or sensitive data
 * @returns Classified risk level
 */
export function classifyRisk(editableFiles: number, destructiveOps: boolean, touchSecrets: boolean): RiskLevel {
  // Critical: touching secrets
  if (touchSecrets) {
    return "critical";
  }

  // High: multiple files or destructive operations
  if (editableFiles >= 5 || destructiveOps) {
    return "high";
  }

  // Moderate: some files but not many and not destructive
  if (editableFiles >= 1 && editableFiles < 5) {
    return "moderate";
  }

  // Safe: no files, no destructive ops
  if (editableFiles === 0 && !destructiveOps) {
    return "safe";
  }

  // Default to safe
  return "safe";
}
