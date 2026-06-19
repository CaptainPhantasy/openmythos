import assert from "node:assert/strict";
import test from "node:test";
import { pickEmployee, buildCustomEmployee } from "../core/fleet.js";
import { DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_ID } from "../core/omp-client.js";

test("worker temperature descends 0.3 -> 0.1 -> 0.0 by tier", () => {
  assert.equal(pickEmployee("worker", 0).temperature, 0.3);
  assert.equal(pickEmployee("worker", 1).temperature, 0.1);
  assert.equal(pickEmployee("worker", 2).temperature, 0.0);
});

test("worker tier overflow clamps to 0.0", () => {
  assert.equal(pickEmployee("worker", 3).temperature, 0.0);
  assert.equal(pickEmployee("worker", 99).temperature, 0.0);
});

test("worker negative tier clamps to tier 0 (0.3)", () => {
  assert.equal(pickEmployee("worker", -1).temperature, 0.3);
});

test("watcher temperature is always 0 regardless of tier", () => {
  assert.equal(pickEmployee("watcher", 0).temperature, 0);
  assert.equal(pickEmployee("watcher", 5).temperature, 0);
});

test("pickEmployee defaults provider/model to the omp-client constants", () => {
  const w = pickEmployee("worker", 0);
  assert.equal(w.modelProvider, DEFAULT_MODEL_PROVIDER);
  assert.equal(w.modelId, DEFAULT_MODEL_ID);
  assert.equal(w.role, "worker");
  const v = pickEmployee("watcher", 0);
  assert.equal(v.modelProvider, DEFAULT_MODEL_PROVIDER);
  assert.equal(v.modelId, DEFAULT_MODEL_ID);
  assert.equal(v.role, "watcher");
});

test("pickEmployee throws on unknown role", () => {
  assert.throws(() => pickEmployee("supervisor" as never, 0), /Unknown employee role/);
});

test("buildCustomEmployee clamps negative temperature to 0", () => {
  assert.equal(buildCustomEmployee("worker", -1).temperature, 0);
});

test("buildCustomEmployee applies opts overrides and keeps role/defaults", () => {
  const e = buildCustomEmployee("worker", 0.5, { modelId: "x" });
  assert.equal(e.temperature, 0.5);
  assert.equal(e.modelId, "x");
  assert.equal(e.modelProvider, DEFAULT_MODEL_PROVIDER);
  assert.equal(e.role, "worker");
});

test("buildCustomEmployee throws on unknown role", () => {
  assert.throws(() => buildCustomEmployee("supervisor" as never, 0.2), /Unknown employee role/);
});
