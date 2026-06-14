import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultRoutingPolicies,
  routeModel,
  validatePolicies,
  classifyComplexity,
  classifyRisk
} from "../core/model-routing.js";

describe("model-routing", () => {
  it("returns at least 8 default policies", () => {
    const policies = defaultRoutingPolicies();
    assert.ok(policies.length >= 8);
  });

  it("routes bugfix to coder", () => {
    const policies = defaultRoutingPolicies();
    const decision = routeModel(
      { type: "bugfix", complexity: "standard", riskLevel: "moderate", requiresTools: false },
      policies
    );
    assert.equal(decision.role, "coder");
    assert.ok(decision.reason.length > 0);
  });

  it("routes review to critic", () => {
    const policies = defaultRoutingPolicies();
    const decision = routeModel(
      { type: "review", complexity: "standard", riskLevel: "safe", requiresTools: false },
      policies
    );
    assert.equal(decision.role, "critic");
  });

  it("routes research to planner", () => {
    const policies = defaultRoutingPolicies();
    const decision = routeModel(
      { type: "research", complexity: "research", riskLevel: "safe", requiresTools: true },
      policies
    );
    assert.equal(decision.role, "planner");
  });

  it("falls back to coder for unknown type", () => {
    const policies = defaultRoutingPolicies();
    const decision = routeModel(
      { type: "unknown_type", complexity: "standard", riskLevel: "safe", requiresTools: false },
      policies
    );
    assert.ok(decision.role);
    assert.ok(decision.reason.includes("fall"));
  });

  it("falls back to coder when no policies", () => {
    const decision = routeModel(
      { type: "bugfix", complexity: "standard", riskLevel: "safe", requiresTools: false },
      []
    );
    assert.equal(decision.role, "coder");
  });

  it("validates clean policies", () => {
    const policies = defaultRoutingPolicies();
    const result = validatePolicies(policies);
    assert.ok(result.valid);
    assert.equal(result.issues.length, 0);
  });

  it("classifies trivial complexity", () => {
    assert.equal(classifyComplexity("fix typo", 1, 10), "trivial");
  });

  it("classifies research complexity", () => {
    assert.equal(classifyComplexity("large migration", 10, 5000), "research");
  });

  it("classifies safe risk", () => {
    assert.equal(classifyRisk(0, false, false), "safe");
  });

  it("classifies critical risk for secrets", () => {
    assert.equal(classifyRisk(1, false, true), "critical");
  });

  it("classifies high risk for destructive ops", () => {
    assert.equal(classifyRisk(5, true, false), "high");
  });
});
