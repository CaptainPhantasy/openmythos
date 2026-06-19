import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  createBudget,
  addToBudget,
  remainingTokens,
  shouldCompress,
  fitToWindow,
  planCompression,
} from "../core/context-window.js";

describe("context-window: token estimation (real logic)", () => {
  it("returns 0 for empty string", () => {
    assert.equal(estimateTokens(""), 0);
  });

  it("estimates ~ceil(length/4) tokens", () => {
    assert.equal(estimateTokens("aaaaaaaa"), 2); // 8 chars / 4
    assert.equal(estimateTokens("abc"), 1); // ceil(3/4)
  });
});

describe("context-window: budget tracking (real logic)", () => {
  it("initializes usedTokens to 0", () => {
    const budget = createBudget(1000, 100);
    assert.equal(budget.usedTokens, 0);
    assert.equal(budget.maxTokens, 1000);
    assert.equal(budget.reservedTokens, 100);
  });

  it("addToBudget is immutable and increases usedTokens", () => {
    const budget = createBudget(1000);
    const updated = addToBudget(budget, "aaaaaaaa"); // 2 tokens
    assert.equal(budget.usedTokens, 0, "original budget unchanged");
    assert.equal(updated.usedTokens, 2);
  });

  it("remainingTokens accounts for reserved tokens", () => {
    let budget = createBudget(100, 20);
    budget = addToBudget(budget, "a".repeat(40)); // 10 tokens
    assert.equal(remainingTokens(budget), 100 - 20 - 10);
  });

  it("remainingTokens never goes negative", () => {
    let budget = createBudget(10);
    budget = addToBudget(budget, "a".repeat(100)); // 25 tokens > 10
    assert.equal(remainingTokens(budget), 0);
  });
});

describe("context-window: compression decisions (real logic)", () => {
  it("shouldCompress is false when well under threshold", () => {
    let budget = createBudget(1000);
    budget = addToBudget(budget, "a".repeat(40)); // 10 tokens, 1% of 1000
    assert.equal(shouldCompress(budget), false);
  });

  it("shouldCompress is true when at/over threshold", () => {
    let budget = createBudget(100);
    budget = addToBudget(budget, "a".repeat(360)); // 90 tokens, 90% >= 80%
    assert.equal(shouldCompress(budget), true);
  });

  it("planCompression returns target below current when over threshold", () => {
    let budget = createBudget(100);
    budget = addToBudget(budget, "a".repeat(400)); // 100 tokens
    const decision = planCompression(budget);
    assert.equal(decision.compress, true);
    assert.ok(decision.targetTokens < decision.currentTokens);
    assert.ok(decision.reason.length > 0);
  });
});

describe("context-window: fitToWindow (real logic)", () => {
  it("keeps all snippets when they fit", () => {
    const snippets = ["abcd", "efgh"]; // 1 token each
    const result = fitToWindow(snippets, 100);
    assert.equal(result.kept.length, 2);
    assert.equal(result.dropped, 0);
  });

  it("drops overflow snippets in priority order", () => {
    const snippets = ["a".repeat(40), "b".repeat(40), "c".repeat(40)]; // 10 tokens each
    const result = fitToWindow(snippets, 15); // room for 1
    assert.ok(result.kept.length < snippets.length);
    assert.ok(result.dropped > 0);
    assert.equal(result.kept[0], snippets[0], "highest-priority snippet kept first");
  });
});
