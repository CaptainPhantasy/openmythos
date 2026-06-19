// Context window management: estimate token usage, track a context budget, and
// decide when context must be compressed before it overflows the model window.
// This is what keeps the harness from blowing the context budget on large repos.

export interface ContextBudget {
  maxTokens: number;
  usedTokens: number;
  reservedTokens: number;
}

/**
 * Rough token estimate. Real tokenization varies by model, but ~4 chars/token
 * is a stable approximation for budgeting decisions across GPT/Claude/GLM.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function createBudget(maxTokens: number, reservedTokens = 0): ContextBudget {
  return { maxTokens, usedTokens: 0, reservedTokens };
}

export function addToBudget(budget: ContextBudget, text: string): ContextBudget {
  return { ...budget, usedTokens: budget.usedTokens + estimateTokens(text) };
}

export function remainingTokens(budget: ContextBudget): number {
  return Math.max(0, budget.maxTokens - budget.reservedTokens - budget.usedTokens);
}

/**
 * Whether the budget is past the compression threshold (default 80% of usable
 * window). Past this point the harness should compress context before adding more.
 */
export function shouldCompress(budget: ContextBudget, threshold = 0.8): boolean {
  const usable = budget.maxTokens - budget.reservedTokens;
  if (usable <= 0) return true;
  return budget.usedTokens / usable >= threshold;
}

export interface FitResult {
  kept: string[];
  dropped: number;
  droppedTokens: number;
  keptTokens: number;
}

/**
 * Greedily fit snippets into a token window, keeping snippets in priority order
 * (earliest = highest priority) until the budget is exhausted. Returns which
 * snippets were kept and how many were dropped.
 */
export function fitToWindow(snippets: string[], maxTokens: number): FitResult {
  const kept: string[] = [];
  let keptTokens = 0;
  let dropped = 0;
  let droppedTokens = 0;

  for (const snippet of snippets) {
    const tokens = estimateTokens(snippet);
    if (keptTokens + tokens <= maxTokens) {
      kept.push(snippet);
      keptTokens += tokens;
    } else {
      dropped++;
      droppedTokens += tokens;
    }
  }

  return { kept, dropped, droppedTokens, keptTokens };
}

export interface CompressionDecision {
  compress: boolean;
  reason: string;
  targetTokens: number;
  currentTokens: number;
}

/**
 * Decide whether and how aggressively to compress. When over threshold, returns
 * a target token count to compress down to (60% of usable window by default).
 */
export function planCompression(
  budget: ContextBudget,
  threshold = 0.8,
  targetRatio = 0.6
): CompressionDecision {
  const usable = budget.maxTokens - budget.reservedTokens;
  const compress = shouldCompress(budget, threshold);
  return {
    compress,
    reason: compress
      ? `Context at ${budget.usedTokens}/${usable} tokens (>= ${Math.round(threshold * 100)}% threshold)`
      : `Context within budget: ${budget.usedTokens}/${usable} tokens`,
    targetTokens: Math.floor(usable * targetRatio),
    currentTokens: budget.usedTokens,
  };
}
