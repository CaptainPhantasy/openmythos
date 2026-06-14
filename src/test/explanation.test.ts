import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { explainPlan, explainVerification, formatExplanation, explainTaskRouting } from "../core/explanation.js";

describe("explanation", () => {
  it("explains empty plan", () => {
    const result = explainPlan({ tasks: [] });
    assert.ok(result.summary.includes("No tasks"));
  });

  it("explains plan with tasks", () => {
    const result = explainPlan({
      tasks: [
        { id: "t1", role: "coder", description: "fix bug", tools: ["filesystem.read"] },
        { id: "t2", role: "critic", description: "review fix", tools: ["git.diff"], dependsOn: ["t1"] }
      ]
    });
    assert.ok(result.summary.includes("2 tasks"));
    assert.ok(result.details.length > 0);
  });

  it("explains verification results", () => {
    const result = explainVerification(
      ["lint", "build", "test"],
      [
        { preset: "lint", passed: true },
        { preset: "build", passed: true },
        { preset: "test", passed: false }
      ]
    );
    assert.equal(result.confidence, "low");
    assert.ok(result.failed.includes("test"));
    assert.ok(result.passed.includes("lint"));
  });

  it("explains verification all pass", () => {
    const result = explainVerification(
      ["lint", "build"],
      [
        { preset: "lint", passed: true },
        { preset: "build", passed: true }
      ]
    );
    assert.equal(result.confidence, "high");
  });

  it("formats explanation with indentation", () => {
    const text = formatExplanation({
      summary: "Test summary",
      details: ["Detail 1", "Detail 2"],
      recommendations: ["Rec 1"]
    });
    assert.ok(text.includes("Test summary"));
    assert.ok(text.includes("Detail 1"));
    assert.ok(text.includes("Rec 1"));
  });

  it("explains task routing for coder role", () => {
    const result = explainTaskRouting({
      role: "coder",
      description: "Implement feature X",
      tools: ["filesystem.write", "shell.run"]
    });
    assert.equal(result.role, "coder");
    assert.ok(result.rationale.includes("coder"));
  });
});
