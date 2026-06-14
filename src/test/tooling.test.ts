import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlanTools } from "../core/tooling.js";
import type { Plan } from "../core/types.js";

test("normalizePlanTools maps common aliases onto supported tool ids", () => {
  const plan: Plan = {
    goal: "Alias test",
    dependencies: {},
    successCriteria: ["done"],
    tasks: [{
      id: "task-1",
      title: "Alias",
      description: "Alias",
      role: "coder",
      fileTargets: ["file.txt"],
      acceptanceCriteria: ["done"],
      requiredTools: ["write", "bash", "write"],
      verificationCommands: [],
      executionMode: "serial"
    }]
  };

  const normalized = normalizePlanTools(plan);
  assert.deepEqual(normalized.issues, []);
  assert.deepEqual(normalized.plan.tasks[0]?.requiredTools, ["filesystem.write", "shell.run"]);
});

test("normalizePlanTools reports unsupported tools and role mismatches", () => {
  const plan: Plan = {
    goal: "Mismatch test",
    dependencies: {},
    successCriteria: ["done"],
    tasks: [{
      id: "task-1",
      title: "Mismatch",
      description: "Mismatch",
      role: "critic",
      fileTargets: [],
      acceptanceCriteria: ["done"],
      requiredTools: ["deploy.prod", "shell.run"],
      verificationCommands: [],
      executionMode: "serial"
    }]
  };

  const normalized = normalizePlanTools(plan);
  assert.deepEqual(
    normalized.issues.map((issue) => issue.reason),
    ["unsupported", "role_mismatch"]
  );
});
