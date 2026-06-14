import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { Runner } from "../core/runner.js";
import { StateStore } from "../state/store.js";

test("Runner completes a full deterministic fake-adapter run", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-fake-run-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("fake run");
  const marker = await readFile(resolve(workdir, "openmythos-fake-output.txt"), "utf8");
  const state = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "state.json"), "utf8")) as { status: string };
  const qa = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "qa.json"), "utf8")) as { passed: boolean };
  const execution = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "execution.json"), "utf8")) as Array<{
    status: string;
    verificationCommands: string[];
  }>;
  const metrics = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "metrics.json"), "utf8")) as {
    status: string;
    contextFileCount: number;
    taskCount: number;
    taskVerificationCount: number;
    taskVerificationFailureCount: number;
    modelUsage: Array<{ role: string; calls: number }>;
  };

  assert.equal(result.status, "completed");
  assert.equal(marker, "OPENMYTHOS_FAKE_SUCCESS\n");
  assert.equal(state.status, "completed");
  assert.equal(qa.passed, true);
  assert.equal(execution[0]?.status, "success");
  assert.equal(execution[0]?.verificationCommands.length, 2);
  assert.equal(metrics.status, "completed");
  assert.equal(metrics.taskCount, 1);
  assert.equal(metrics.taskVerificationCount, 2);
  assert.equal(metrics.taskVerificationFailureCount, 0);
  assert.ok(metrics.contextFileCount >= 0);
  assert.ok(metrics.modelUsage.length > 0);
  assert.ok(metrics.modelUsage.some((entry) => entry.role === "planner" && entry.calls >= 1));
  assert.ok(result.artifacts.some((artifact) => artifact.endsWith("issue.json")) === false);
});

test("Runner fails when task-level verification commands fail", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-fake-task-verify-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  config.execution.maxRetries = 0;
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("failing task verification");
  const qa = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "qa.json"), "utf8")) as {
    passed: boolean;
    issues: Array<{ description: string }>;
  };
  const execution = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "execution.json"), "utf8")) as Array<{
    status: string;
  }>;
  const metrics = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "metrics.json"), "utf8")) as {
    status: string;
    taskVerificationFailureCount: number;
  };

  assert.equal(result.status, "failed");
  assert.equal(qa.passed, false);
  assert.equal(execution[0]?.status, "error");
  assert.equal(metrics.status, "failed");
  assert.equal(metrics.taskVerificationFailureCount, 1);
  assert.match(qa.issues[0]?.description ?? "", /Task verification failed/);
});

test("Runner normalizes planner-selected tool aliases before execution", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-fake-tool-alias-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("alias tool normalization");
  const execution = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "execution.json"), "utf8")) as Array<{
    requiredTools: string[];
  }>;

  assert.equal(result.status, "completed");
  assert.deepEqual(execution[0]?.requiredTools, ["filesystem.write", "shell.run"]);
});

test("Runner routes verifier tasks through the verifier execution lane", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-fake-verifier-route-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("verifier task routing");
  const execution = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "execution.json"), "utf8")) as Array<{
    taskId: string;
    executorKind: string;
    executorRole: string;
    status: string;
  }>;

  assert.equal(result.status, "completed");
  assert.deepEqual(
    execution.map((receipt) => [receipt.taskId, receipt.executorKind, receipt.executorRole, receipt.status]),
    [
      ["task-1", "model", "coder", "success"],
      ["task-2", "model", "verifier", "success"]
    ]
  );
});

test("Runner can execute verifier tasks on the harness executor path", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-fake-harness-route-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("harness task execution");
  const execution = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "execution.json"), "utf8")) as Array<{
    taskId: string;
    executorKind: string;
    executorRole: string;
    status: string;
  }>;
  const metrics = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "metrics.json"), "utf8")) as {
    modelTaskCount: number;
    harnessTaskCount: number;
  };

  assert.equal(result.status, "completed");
  assert.deepEqual(
    execution.map((receipt) => [receipt.taskId, receipt.executorKind, receipt.executorRole, receipt.status]),
    [
      ["task-1", "model", "coder", "success"],
      ["task-2", "harness", "verifier", "success"]
    ]
  );
  assert.equal(metrics.modelTaskCount, 1);
  assert.equal(metrics.harnessTaskCount, 1);
});

test("Runner can stop in awaiting_approval before applying risky edits", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-fake-approval-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  config.approval.mode = "enforce";
  config.approval.protectedPaths = ["openmythos-fake-output.txt"];

  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);
  const result = await runner.run("fake run requiring approval");

  const state = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "state.json"), "utf8")) as {
    status: string;
    error: string | null;
  };
  const review = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "review-task-1.json"), "utf8")) as {
    blocking: boolean;
    highestRisk: string;
  };

  await assert.rejects(
    () => readFile(resolve(workdir, "openmythos-fake-output.txt"), "utf8")
  );
  assert.equal(result.status, "awaiting_approval");
  assert.equal(state.status, "awaiting_approval");
  assert.equal(review.blocking, true);
  assert.equal(review.highestRisk, "high");
  assert.match(state.error ?? "", /Approval required/);
});
