import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";

test("record-baseline prefers the root summary.json over nested fixture summaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmythos-record-baseline-"));
  const sourceDir = resolve(root, "codex-suite");
  const workdir = resolve(root, "workspace");
  await mkdir(resolve(sourceDir, "fixture-noop-js"), { recursive: true });
  await mkdir(workdir, { recursive: true });

  await writeFile(resolve(sourceDir, "summary.json"), JSON.stringify({
    schemaVersion: "comparative-baseline.v1",
    evidenceType: "comparative",
    mode: "suite",
    passed: true,
    fixtures: [
      { fixture: "noop-js" },
      { fixture: "trim-js" }
    ]
  }, null, 2), "utf8");

  await writeFile(resolve(sourceDir, "fixture-noop-js/summary.json"), JSON.stringify({
    schemaVersion: "comparative-baseline-fixture.v1",
    evidenceType: "comparative",
    mode: "fixture",
    passed: true,
    fixture: "noop-js"
  }, null, 2), "utf8");

  execFileSync(
    "node",
    [resolve(process.cwd(), "dist/index.js"), "record-baseline", "codex", sourceDir, "--workdir", workdir],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  const importedRoot = resolve(workdir, "runs/comparative-baselines/codex", basename(sourceDir));
  const manifest = JSON.parse(await readFile(resolve(importedRoot, "record-baseline.json"), "utf8")) as {
    sourceSummary: string;
    summary: { fixtures?: string[] };
  };

  assert.equal(manifest.sourceSummary, resolve(sourceDir, "summary.json"));
  assert.deepEqual(manifest.summary.fixtures, ["noop-js", "trim-js"]);
});
