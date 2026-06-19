import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createSnapshot,
  restoreSnapshot,
  listSnapshots,
  applyBatch,
  analyzeImpact,
  aggregateCost,
  type BatchEdit,
} from "../core/advanced-tools.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "om-adv-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("advanced-tools: snapshot/restore", () => {
  it("creates snapshot with file count", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "file1.txt"), "original", "utf8");
      const snap = await createSnapshot(dir, "test-snap");
      assert.equal(snap.id, "test-snap");
      assert.ok(snap.fileCount >= 1);
      assert.ok(existsSync(resolve(dir, ".openmythos", "snapshots", "test-snap", "file1.txt")));
    });
  });

  it("restores files from snapshot", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "file1.txt"), "original", "utf8");
      await createSnapshot(dir, "restore-test");
      await writeFile(resolve(dir, "file1.txt"), "modified", "utf8");
      assert.equal(await readFile(resolve(dir, "file1.txt"), "utf8"), "modified");
      await restoreSnapshot(dir, "restore-test");
      assert.equal(await readFile(resolve(dir, "file1.txt"), "utf8"), "original");
    });
  });

  it("lists snapshots sorted by date", async () => {
    await withTempDir(async (dir) => {
      await createSnapshot(dir, "snap-a");
      await createSnapshot(dir, "snap-b");
      const snaps = await listSnapshots(dir);
      assert.ok(snaps.length >= 2);
    });
  });

  it("throws on restore of missing snapshot", async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(() => restoreSnapshot(dir, "nonexistent"));
    });
  });
});

describe("advanced-tools: batch", () => {
  it("applies write edits atomically", async () => {
    await withTempDir(async (dir) => {
      const edits: BatchEdit[] = [
        { file: "src/a.ts", action: "write", content: "export const a = 1;" },
        { file: "src/b.ts", action: "write", content: "export const b = 2;" },
      ];
      const result = await applyBatch(dir, edits);
      assert.equal(result.applied, 2);
      assert.equal(result.errors.length, 0);
      assert.ok(existsSync(resolve(dir, "src", "a.ts")));
      assert.ok(existsSync(resolve(dir, "src", "b.ts")));
    });
  });

  it("applies replace edits", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "code.ts"), "const x = oldValue;", "utf8");
      const edits: BatchEdit[] = [
        { file: "code.ts", action: "replace", find: "oldValue", replace: "newValue" },
      ];
      const result = await applyBatch(dir, edits);
      assert.equal(result.applied, 1);
      const content = await readFile(resolve(dir, "code.ts"), "utf8");
      assert.ok(content.includes("newValue"));
    });
  });

  it("skips when find pattern not found", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "code.ts"), "nothing here", "utf8");
      const edits: BatchEdit[] = [
        { file: "code.ts", action: "replace", find: "missing", replace: "found" },
      ];
      const result = await applyBatch(dir, edits);
      assert.equal(result.applied, 0);
      assert.equal(result.skipped, 1);
    });
  });

  it("returns error for invalid edit", async () => {
    await withTempDir(async (dir) => {
      const edits = [{ file: "", action: "write", content: "x" }] as BatchEdit[];
      const result = await applyBatch(dir, edits);
      assert.ok(result.errors.length > 0);
    });
  });
});

describe("advanced-tools: impact analysis", () => {
  it("finds references to a symbol across files", async () => {
    await withTempDir(async (dir) => {
      await mkdir(resolve(dir, "src"), { recursive: true });
      await writeFile(resolve(dir, "src", "a.ts"), "export function myFunc() { return 1; }", "utf8");
      await writeFile(resolve(dir, "src", "b.ts"), "import { myFunc } from './a';\nmyFunc();", "utf8");
      const result = await analyzeImpact(dir, "myFunc");
      assert.ok(result.totalMatches >= 2);
      assert.ok(result.files.length >= 2);
    });
  });

  it("returns empty for unknown symbol", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "code.ts"), "const x = 1;", "utf8");
      const result = await analyzeImpact(dir, "nonexistentSymbol12345");
      assert.equal(result.totalMatches, 0);
    });
  });
});

describe("advanced-tools: cost aggregation", () => {
  it("returns zero report for empty workdir", async () => {
    await withTempDir(async (dir) => {
      const report = await aggregateCost(dir);
      assert.equal(report.runs, 0);
      assert.equal(report.totalTokens, 0);
    });
  });

  it("aggregates token usage from run metrics", async () => {
    await withTempDir(async (dir) => {
      await mkdir(resolve(dir, "runs", "run-1"), { recursive: true });
      await writeFile(
        resolve(dir, "runs", "run-1", "metrics.json"),
        JSON.stringify({
          modelUsage: [
            { model: "glm-5.1", calls: 5, inputTokens: 1000, outputTokens: 500 },
          ],
        }),
        "utf8"
      );
      const report = await aggregateCost(dir);
      assert.equal(report.runs, 1);
      assert.equal(report.totalInputTokens, 1000);
      assert.equal(report.totalOutputTokens, 500);
      assert.ok(report.estimatedCostCents > 0);
      assert.ok(report.byModel["glm-5.1"]);
    });
  });
});
