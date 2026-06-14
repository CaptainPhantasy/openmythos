import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
