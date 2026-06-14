import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionBatches, sortTasks } from "../core/toposort.js";
import type { PlanTask } from "../core/types.js";

const tasks: PlanTask[] = [
  { id: "b", title: "B", description: "B", role: "coder", fileTargets: [], acceptanceCriteria: ["b"], requiredTools: [], verificationCommands: [], executionMode: "serial" },
  { id: "a", title: "A", description: "A", role: "coder", fileTargets: [], acceptanceCriteria: ["a"], requiredTools: [], verificationCommands: [], executionMode: "serial" }
];

test("sortTasks orders dependencies before dependents", () => {
  assert.deepEqual(sortTasks(tasks, { b: ["a"] }).map((task) => task.id), ["a", "b"]);
});

test("sortTasks rejects cycles", () => {
  assert.throws(() => sortTasks(tasks, { a: ["b"], b: ["a"] }), /Circular task dependency/);
});

test("buildExecutionBatches groups dependency-free parallel tasks and isolates conflicting or serial tasks", () => {
  const planned: PlanTask[] = [
    { id: "a", title: "A", description: "A", role: "coder", fileTargets: ["src/a.ts"], acceptanceCriteria: ["a"], requiredTools: ["filesystem.read"], verificationCommands: [], executionMode: "parallel" },
    { id: "b", title: "B", description: "B", role: "coder", fileTargets: ["src/b.ts"], acceptanceCriteria: ["b"], requiredTools: ["filesystem.read"], verificationCommands: [], executionMode: "parallel" },
    { id: "c", title: "C", description: "C", role: "coder", fileTargets: ["src/a.ts"], acceptanceCriteria: ["c"], requiredTools: ["filesystem.write"], verificationCommands: [], executionMode: "parallel" },
    { id: "d", title: "D", description: "D", role: "critic", fileTargets: [], acceptanceCriteria: ["d"], requiredTools: ["review"], verificationCommands: [], executionMode: "serial" }
  ];

  const batches = buildExecutionBatches(planned, {});
  assert.deepEqual(
    batches.map((batch) => batch.map((task) => task.id)),
    [["a", "b"], ["c"], ["d"]]
  );
});
