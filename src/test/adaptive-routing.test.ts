import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRoutingStats,
  recordOutcome,
  getSuccessRate,
  getAdaptiveRole,
} from "../core/adaptive-routing.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "om-routing-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("adaptive-routing: persistence (real filesystem I/O)", () => {
  it("loadRoutingStats returns empty performance for a fresh dir", async () => {
    await withTempDir(async (dir) => {
      const stats = await loadRoutingStats(dir);
      assert.equal(stats.performance.length, 0);
    });
  });

  it("recordOutcome persists and a reload reflects the attempt", async () => {
    await withTempDir(async (dir) => {
      await recordOutcome(dir, "bugfix", "coder", true, 1200);
      const reloaded = await loadRoutingStats(dir);
      assert.equal(getSuccessRate(reloaded, "bugfix", "coder"), 1);
    });
  });

  it("accumulates multiple outcomes into a real success rate", async () => {
    await withTempDir(async (dir) => {
      await recordOutcome(dir, "feature", "coder", true, 1000);
      await recordOutcome(dir, "feature", "coder", true, 1000);
      await recordOutcome(dir, "feature", "coder", false, 1000);
      const stats = await loadRoutingStats(dir);
      const rate = getSuccessRate(stats, "feature", "coder");
      assert.ok(Math.abs(rate - 2 / 3) < 1e-9, `expected 2/3, got ${rate}`);
    });
  });

  it("getSuccessRate returns -1 for unknown taskType/role", async () => {
    await withTempDir(async (dir) => {
      const stats = await loadRoutingStats(dir);
      assert.equal(getSuccessRate(stats, "unknown", "coder"), -1);
    });
  });
});

describe("adaptive-routing: adaptive role selection (real logic)", () => {
  it("returns fallback with basedOnHistory:false below minAttempts", async () => {
    await withTempDir(async (dir) => {
      await recordOutcome(dir, "refactor", "coder", true, 1000);
      const stats = await loadRoutingStats(dir);
      const decision = getAdaptiveRole(stats, "refactor", ["coder", "critic"], "coder");
      assert.equal(decision.basedOnHistory, false);
      assert.equal(decision.role, "coder");
    });
  });

  it("picks the higher-success role when both have enough attempts", async () => {
    await withTempDir(async (dir) => {
      // roleA: 3/3 success
      await recordOutcome(dir, "review", "critic", true, 500);
      await recordOutcome(dir, "review", "critic", true, 500);
      await recordOutcome(dir, "review", "critic", true, 500);
      // roleB: 1/3 success
      await recordOutcome(dir, "review", "verifier", true, 500);
      await recordOutcome(dir, "review", "verifier", false, 500);
      await recordOutcome(dir, "review", "verifier", false, 500);
      const stats = await loadRoutingStats(dir);
      const decision = getAdaptiveRole(stats, "review", ["critic", "verifier"], "coder");
      assert.equal(decision.role, "critic");
      assert.equal(decision.basedOnHistory, true);
      assert.ok(decision.successRate > 0.9);
    });
  });
});
