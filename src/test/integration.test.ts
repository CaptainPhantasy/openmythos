import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { Runner } from "../core/runner.js";
import { StateStore } from "../state/store.js";
import { PhaseExecutor } from "../core/phases.js";
import { AdapterRegistry } from "../adapters/registry.js";
import type { Plan, TaskOutput, IntakeResult } from "../core/types.js";

test("Integration: model routing populates routing context on plan tasks", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "om-int-routing-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("fake run");
  assert.equal(result.status, "completed");

  const planPath = resolve(workdir, "runs", result.runId, "plan.json");
  const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
  assert.ok(plan.tasks.length > 0, "plan should have tasks");

  const routedTasks = plan.tasks.filter((t) => t.routing);
  assert.ok(
    routedTasks.length > 0,
    `expected at least one task with routing context, got ${routedTasks.length}/${plan.tasks.length}`
  );

  const routing = routedTasks[0]!.routing!;
  assert.ok(routing.taskType.length > 0, "routing.taskType should be populated");
  assert.ok(routing.complexity.length > 0, "routing.complexity should be populated");
  assert.ok(routing.riskLevel.length > 0, "routing.riskLevel should be populated");
  assert.ok(routing.routedRole.length > 0, "routing.routedRole should be populated");
  assert.ok(routing.routingReason.length > 0, "routing.routingReason should be populated");
});

test("Integration: memory persists run note after successful completion", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "om-int-memory-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("fake run");
  assert.equal(result.status, "completed");

  const memoryPath = resolve(workdir, ".openmythos", "memory.json");
  const memory = JSON.parse(await readFile(memoryPath, "utf8")) as {
    notes: Array<{ content: string; tags: string[] }>;
  };
  assert.ok(memory.notes.length > 0, "memory should have at least one note");
  assert.ok(
    memory.notes.some((n) => n.tags.includes("run")),
    "memory should contain a note tagged 'run'"
  );
});

test("Integration: guardrails blocks verify when changed file contains a secret", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "om-int-guard-"));
  await mkdir(resolve(workdir, "src"), { recursive: true });

  const secretKey = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
  await writeFile(resolve(workdir, "src", "config.ts"), `const apiKey = "${secretKey}";\n`, "utf8");
  await writeFile(resolve(workdir, "openmythos-fake-output.txt"), "OPENMYTHOS_FAKE_SUCCESS\n", "utf8");

  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runDir = resolve(workdir, "runs", "test-run");
  await mkdir(runDir, { recursive: true });

  const executor = new PhaseExecutor(config, new AdapterRegistry(config), workdir, runDir);

  const plan: Plan = {
    goal: "test",
    tasks: [],
    dependencies: {},
    successCriteria: ["no secrets in code"],
  };
  const outputs: TaskOutput[] = [{
    taskId: "task-1",
    status: "success",
    fileEdits: [{
      path: "src/config.ts",
      action: "modify" as const,
      content: `const apiKey = "${secretKey}";`,
      description: "add config",
    }],
    summary: "modified config",
    errors: [],
  }];
  const intake: IntakeResult = {
    taskType: "feature",
    description: "test guardrails",
    successCriteria: ["no secrets"],
    complexity: "low",
    relevantPatterns: [],
  };

  const qa = await executor.verify("test goal", plan, outputs, intake);
  assert.equal(qa.passed, false, "QA should fail when a secret is detected");
  assert.ok(
    qa.issues.some((i) => i.description.toLowerCase().includes("secret") || i.description.toLowerCase().includes("akia")),
    `QA issues should mention the secret finding, got: ${qa.issues.map((i) => i.description).join("; ")}`
  );
});

test("Integration: metrics include routing and rework fields after a run", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "om-int-metrics-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("fake run");
  assert.equal(result.status, "completed");

  const metricsPath = resolve(workdir, "runs", result.runId, "metrics.json");
  const metrics = JSON.parse(await readFile(metricsPath, "utf8")) as {
    reworkCount: number;
    routingDecisions: number;
  };
  assert.ok(typeof metrics.reworkCount === "number", "metrics should include reworkCount");
  assert.ok(typeof metrics.routingDecisions === "number", "metrics should include routingDecisions");
  assert.ok(metrics.routingDecisions >= 0, "routingDecisions should be non-negative");
});
