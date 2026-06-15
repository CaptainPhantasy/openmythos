import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFanoutBatches, fanOut, mapWithConcurrency, type FanoutTask } from "../core/fanout.js";

describe("fanout: dependency batching (real logic)", () => {
  it("places independent tasks in a single batch", () => {
    const tasks: FanoutTask<string>[] = [
      { id: "a", run: async () => "a" },
      { id: "b", run: async () => "b" },
    ];
    const batches = buildFanoutBatches(tasks);
    assert.equal(batches.length, 1);
    assert.equal(batches[0]!.length, 2);
  });

  it("orders dependent tasks into separate batches", () => {
    const tasks: FanoutTask<string>[] = [
      { id: "a", run: async () => "a" },
      { id: "b", dependsOn: ["a"], run: async () => "b" },
    ];
    const batches = buildFanoutBatches(tasks);
    assert.equal(batches.length, 2);
    assert.equal(batches[0]![0]!.id, "a");
    assert.equal(batches[1]![0]!.id, "b");
  });

  it("throws on a dependency cycle", () => {
    const tasks: FanoutTask<string>[] = [
      { id: "a", dependsOn: ["b"], run: async () => "a" },
      { id: "b", dependsOn: ["a"], run: async () => "b" },
    ];
    assert.throws(() => buildFanoutBatches(tasks));
  });
});

describe("fanout: parallel execution (real async)", () => {
  it("runs all tasks and returns completed results in input order", async () => {
    const tasks: FanoutTask<string>[] = [
      { id: "x", run: async () => "result-x" },
      { id: "y", run: async () => "result-y" },
      { id: "z", run: async () => "result-z" },
    ];
    const results = await fanOut(tasks);
    assert.equal(results.length, 3);
    assert.equal(results[0]!.id, "x");
    assert.equal(results[0]!.status, "completed");
    assert.equal(results[0]!.result, "result-x");
    assert.ok(results.every((r) => r.status === "completed"));
  });

  it("captures a throwing task as failed while siblings complete", async () => {
    const tasks: FanoutTask<string>[] = [
      { id: "ok", run: async () => "fine" },
      { id: "bad", run: async () => { throw new Error("boom"); } },
    ];
    const results = await fanOut(tasks);
    const ok = results.find((r) => r.id === "ok")!;
    const bad = results.find((r) => r.id === "bad")!;
    assert.equal(ok.status, "completed");
    assert.equal(bad.status, "failed");
    assert.ok(bad.error!.includes("boom"));
  });

  it("respects dependency order: dependent runs after its dependency", async () => {
    const order: string[] = [];
    const tasks: FanoutTask<void>[] = [
      { id: "first", run: async () => { order.push("first"); } },
      { id: "second", dependsOn: ["first"], run: async () => { order.push("second"); } },
    ];
    await fanOut(tasks);
    assert.deepEqual(order, ["first", "second"]);
  });

  it("runs independent tasks concurrently (deterministic barrier, no timers)", async () => {
    // Prove concurrency without wall-clock delay: each task signals it has
    // started, then blocks on a shared barrier. If all three reach the started
    // state before any is released, they were genuinely running concurrently.
    const release = Promise.withResolvers<void>();
    const startedGates = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    let active = 0;
    let maxActive = 0;

    const tasks: FanoutTask<void>[] = startedGates.map((gate, i) => ({
      id: `t${i}`,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        gate.resolve();
        await release.promise;
        active--;
      },
    }));

    const fanoutPromise = fanOut(tasks, 3);
    await Promise.all(startedGates.map((g) => g.promise));
    assert.equal(maxActive, 3, "all three tasks should be active simultaneously");
    release.resolve();
    const results = await fanoutPromise;
    assert.ok(results.every((r) => r.status === "completed"));
  });
});

describe("mapWithConcurrency: bounded concurrency (deterministic, no timers)", () => {
  it("never exceeds the concurrency cap", async () => {
    const cap = 2;
    const releases = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const startedGates = releases.map(() => Promise.withResolvers<void>());
    const started = [false, false, false, false];
    let active = 0;
    let maxActive = 0;

    const mapPromise = mapWithConcurrency(
      [0, 1, 2, 3],
      async (i) => {
        active++;
        maxActive = Math.max(maxActive, active);
        started[i] = true;
        startedGates[i]!.resolve();
        await releases[i]!.promise;
        active--;
        return i * 10;
      },
      cap
    );

    // First wave: exactly `cap` tasks start; the rest stay queued.
    await startedGates[0]!.promise;
    await startedGates[1]!.promise;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(active, cap, "exactly cap tasks active in first wave");
    assert.equal(maxActive, cap, "max active never exceeds cap");
    assert.equal(started[2], false, "third task must not start until a slot frees");
    assert.equal(started[3], false, "fourth task must not start until a slot frees");

    // Free one slot -> the next queued task starts, still within the cap.
    releases[0]!.resolve();
    await startedGates[2]!.promise;
    assert.equal(maxActive, cap, "still bounded after a slot frees");

    // Drain the rest.
    releases[1]!.resolve();
    releases[2]!.resolve();
    releases[3]!.resolve();
    const results = await mapPromise;
    assert.deepEqual(results, [0, 10, 20, 30], "results preserved in input order");
    assert.equal(maxActive, cap, "cap respected for the whole run");
  });
});
