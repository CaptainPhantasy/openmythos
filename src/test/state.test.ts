import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { StateStore } from "../state/store.js";

test("StateStore persists state and events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-state-"));
  const store = new StateStore(dir);
  await store.createRun("run-1", "goal", 2);
  await store.updatePhase("run-1", "plan");
  await store.emit("run-1", {
    phase: "plan",
    action: "test",
    status: "success",
    summary: "event persisted",
    artifacts: ["plan.json"],
    nextActions: [],
    durationMs: 1
  });

  const state = await store.loadRun("run-1");
  const events = await store.loadEvents("run-1");
  assert.equal(state?.currentPhase, "plan");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.summary, "event persisted");
});

test("StateStore.listRuns skips corrupted run state files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-state-corrupt-"));
  const store = new StateStore(dir);
  await store.createRun("run-good", "goal", 1);

  await mkdir(resolve(dir, "run-bad"), { recursive: true });
  await writeFile(resolve(dir, "run-bad", "state.json"), "{", "utf8");

  const runs = await store.listRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.runId, "run-good");
});

test("StateStore.queue archives current artifacts outside the active artifact listing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-state-queue-"));
  const store = new StateStore(dir);
  await store.createRun("run-1", "goal", 1);
  await store.writeArtifact("run-1", "metrics.json", { status: "completed" });
  await store.writeArtifact("run-1", "plan.json", { tasks: [] });

  const queued = await store.queue("run-1");
  assert.equal(queued.status, "queued");

  const artifacts = await store.listArtifacts("run-1");
  assert.deepEqual(artifacts, ["state.json"]);

  const historyEntries = await readdir(resolve(dir, "run-1", ".history"));
  assert.equal(historyEntries.length, 1);
});

test("StateStore.listAttempts exposes archived queue history with preserved state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-state-attempts-"));
  const store = new StateStore(dir);
  await store.createRun("run-1", "goal", 1);
  await store.complete("run-1", "done");
  await store.writeArtifact("run-1", "metrics.json", { status: "completed" });
  await store.writeArtifact("run-1", "plan.json", { tasks: [] });

  await store.queue("run-1");

  const attempts = await store.listAttempts("run-1");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.attemptId, "current");
  assert.equal(attempts[0]?.kind, "current");
  assert.equal(attempts[0]?.state?.status, "queued");
  assert.equal(attempts[1]?.kind, "history");
  assert.equal(attempts[1]?.reason, "queue");
  assert.equal(attempts[1]?.state?.status, "completed");
  assert.ok(attempts[1]?.archivedAt);
});

test("StateStore.listAttempts reconstructs legacy archived attempt state from metrics when state.json is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-state-legacy-attempt-"));
  const store = new StateStore(dir);
  await store.createRun("run-1", "goal", 2);

  const legacyDir = resolve(dir, "run-1", ".history", "queue-legacy");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(resolve(legacyDir, "metrics.json"), JSON.stringify({
    runId: "run-1",
    goal: "goal",
    status: "completed",
    startedAt: "2026-06-14T00:00:00.000Z",
    completedAt: "2026-06-14T00:00:01.000Z",
    totalDurationMs: 1000,
    retryCount: 0,
    phaseCount: 6,
    contextFileCount: 0,
    taskCount: 1,
    modelTaskCount: 1,
    harnessTaskCount: 0,
    modelToolTurnCount: 0,
    modelToolCallCount: 0,
    fileEditCount: 1,
    patchEditCount: 0,
    deleteEditCount: 0,
    highRiskReviewCount: 0,
    blockingReviewCount: 0,
    localVerificationCount: 0,
    localVerificationFailureCount: 0,
    taskVerificationCount: 0,
    taskVerificationFailureCount: 0,
    qaPassed: true,
    qaScore: 100,
    modelUsage: []
  }, null, 2), "utf8");

  const attempts = await store.listAttempts("run-1");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1]?.attemptId, "queue-legacy");
  assert.equal(attempts[1]?.state?.status, "completed");
  assert.equal(attempts[1]?.state?.currentPhase, "complete");
  assert.deepEqual(attempts[1]?.state?.phasesCompleted, ["intake", "context", "plan", "execute", "verify", "complete"]);
});

test("StateStore.listArtifacts ignores transient atomic-write temp files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-state-temp-artifacts-"));
  const store = new StateStore(dir);
  await store.createRun("run-1", "goal", 1);
  await writeFile(resolve(dir, "run-1", "state.json.tmp-123-456"), "{}", "utf8");

  const artifacts = await store.listArtifacts("run-1");
  assert.deepEqual(artifacts, ["state.json"]);
});
