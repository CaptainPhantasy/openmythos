import assert from "node:assert/strict";
import test from "node:test";
import { sortTasks } from "../core/toposort.js";
import type { PlanTask } from "../core/types.js";

const tasks: PlanTask[] = [
  { id: "b", title: "B", description: "B", role: "coder", fileTargets: [], acceptanceCriteria: ["b"] },
  { id: "a", title: "A", description: "A", role: "coder", fileTargets: [], acceptanceCriteria: ["a"] }
];

test("sortTasks orders dependencies before dependents", () => {
  assert.deepEqual(sortTasks(tasks, { b: ["a"] }).map((task) => task.id), ["a", "b"]);
});

test("sortTasks rejects cycles", () => {
  assert.throws(() => sortTasks(tasks, { a: ["b"], b: ["a"] }), /Circular task dependency/);
});
