import assert from "node:assert/strict";
import test from "node:test";
import { contextSchema, intakeSchema, planSchema, qaSchema, taskOutputSchema } from "../core/schemas.js";

test("schemas normalize single string list fields from live model output", () => {
  const intake = intakeSchema.parse({
    taskType: "file-create",
    description: "Create marker file",
    successCriteria: "marker file exists",
    complexity: "low",
    relevantPatterns: "*.txt"
  });
  assert.deepEqual(intake.successCriteria, ["marker file exists"]);
  assert.deepEqual(intake.relevantPatterns, ["*.txt"]);

  const trivialIntake = intakeSchema.parse({
    taskType: "file-create",
    description: "Create marker file",
    successCriteria: "marker file exists",
    complexity: "trivial"
  });
  assert.equal(trivialIntake.complexity, "low");

  const context = contextSchema.parse({
    fileManifest: [{ path: "openmythos-live-output.txt" }],
    summary: "No existing files are required.",
    relevantSnippets: [{ path: "openmythos-live-output.txt", content: "OPENMYTHOS_LIVE_SUCCESS\n" }],
    tokenEstimate: "12"
  });
  assert.deepEqual(context.fileManifest, ["openmythos-live-output.txt"]);
  assert.deepEqual(context.relevantSnippets, {
    "openmythos-live-output.txt": "OPENMYTHOS_LIVE_SUCCESS\n"
  });
  assert.equal(context.tokenEstimate, 12);

  const emptyContext = contextSchema.parse({
    fileManifest: {},
    relevantSnippets: []
  });
  assert.deepEqual(emptyContext.fileManifest, []);
  assert.equal(emptyContext.summary, "No relevant repository context found.");
  assert.equal(emptyContext.tokenEstimate, 0);

  const plan = planSchema.parse({
    goal: "Create marker file",
    tasks: [{
      id: "task-1",
      title: "Create marker",
      description: "Create marker file",
      role: "coder",
      executor: "model",
      fileTargets: "openmythos-live-output.txt",
      acceptanceCriteria: "file has exact marker",
      requiredTools: "filesystem.write",
      verificationCommands: "test -f openmythos-live-output.txt",
      executionMode: "parallel"
    }],
    dependencies: { "task-1": "task-0" },
    successCriteria: "file has exact marker"
  });
  const firstTask = plan.tasks[0];
  assert.ok(firstTask);
  assert.deepEqual(firstTask.fileTargets, ["openmythos-live-output.txt"]);
  assert.deepEqual(firstTask.acceptanceCriteria, ["file has exact marker"]);
  assert.deepEqual(firstTask.requiredTools, ["filesystem.write"]);
  assert.deepEqual(firstTask.verificationCommands, ["test -f openmythos-live-output.txt"]);
  assert.equal(firstTask.executor, "model");
  assert.equal(firstTask.executionMode, "parallel");
  assert.deepEqual(plan.dependencies["task-1"], ["task-0"]);
  assert.deepEqual(plan.successCriteria, ["file has exact marker"]);

  const output = taskOutputSchema.parse({
    taskId: "task-1",
    status: "completed",
    fileEdits: [{
      path: "openmythos-live-output.txt",
      action: "create",
      content: "OPENMYTHOS_LIVE_SUCCESS\n"
    }],
    summary: "Created marker",
    errors: "none"
  });
  assert.equal(output.status, "success");
  assert.equal(output.fileEdits[0]?.description, "Model-provided file edit");
  assert.deepEqual(output.errors, ["none"]);

  const outputWithoutEdits = taskOutputSchema.parse({
    taskId: "task-1",
    status: "failed",
    summary: "No edits produced"
  });
  assert.deepEqual(outputWithoutEdits.fileEdits, []);
  assert.deepEqual(outputWithoutEdits.errors, []);

  const qa = qaSchema.parse({
    passed: true,
    score: 100,
    issues: [],
    suggestions: "none",
    verifiedCriteria: "file has exact marker",
    failedCriteria: []
  });
  assert.deepEqual(qa.suggestions, ["none"]);
  assert.deepEqual(qa.verifiedCriteria, ["file has exact marker"]);
});
