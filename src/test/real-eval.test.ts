import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { OpenMythosConfig } from "../config/schema.js";
import { assessRealEvalFixture, copyRealEvalFixture, initializeRealEvalRepository, loadRealEvalFixture, loadRealEvalSuite, usesFakeAdapter } from "../core/real-eval.js";

test("loadRealEvalFixture reads the retained real fixture manifest", async () => {
  const fixture = await loadRealEvalFixture("noop-js");
  assert.equal(fixture.id, "noop-js");
  assert.deepEqual(fixture.expectedChangedFiles, ["src/noop.js"]);
  assert.deepEqual(fixture.verificationCommands, ["npm test"]);
});

test("loadRealEvalSuite reads a retained multi-fixture suite manifest", async () => {
  const suite = await loadRealEvalSuite("daily-workflow-suite");
  assert.equal(suite.id, "daily-workflow-suite");
  assert.equal(suite.fixtures.length, 2);
  assert.equal(suite.fixtures[0]?.id, "noop-js");
  assert.equal(suite.fixtures[1]?.id, "trim-js");
});

test("usesFakeAdapter detects fake-backed model configurations", () => {
  const fakeConfig = {
    models: {
      planner: { adapter: "fake" },
      compressor: { adapter: "zai-coding" },
      coder: { adapter: "zai-coding" },
      critic: { adapter: "zai-coding" },
      verifier: { adapter: "zai-coding" }
    }
  } as OpenMythosConfig;

  assert.equal(usesFakeAdapter(fakeConfig), true);
  fakeConfig.models.planner.adapter = "zai-coding";
  assert.equal(usesFakeAdapter(fakeConfig), false);
});

test("assessRealEvalFixture fails until the expected source file is changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmythos-real-eval-"));
  const repoDir = resolve(root, "repo");
  const fixture = await copyRealEvalFixture("noop-js", repoDir);
  await initializeRealEvalRepository(repoDir, 5000);

  const failing = await assessRealEvalFixture(fixture, repoDir, 5000);
  assert.equal(failing.passed, false);
  assert.equal(failing.verificationResults.length, 1);
  assert.equal(failing.expectedChangedFilesSatisfied, false);

  await writeFile(resolve(repoDir, "src/noop.js"), [
    "export function echoOrFallback(input) {",
    "  const value = typeof input === \"string\" ? input.trim() : \"\";",
    "  if (value.length === 0) {",
    "    return \"fallback\";",
    "  }",
    "  return value;",
    "}",
    ""
  ].join("\n"), "utf8");

  const passing = await assessRealEvalFixture(fixture, repoDir, 5000);
  assert.equal(passing.passed, true);
  assert.deepEqual(passing.changedFiles, ["src/noop.js"]);
  assert.equal(passing.expectedChangedFilesSatisfied, true);
  assert.equal(passing.verificationResults[0]?.exitCode, 0);
  assert.deepEqual(passing.prohibitedArtifactsDetected, []);
});

test("copyRealEvalFixture copies active harness config into fixture repos when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmythos-real-eval-config-"));
  const repoDir = resolve(root, "repo");
  const configPath = resolve(process.cwd(), "openmythos.config.json");

  const fixture = await copyRealEvalFixture("noop-js", repoDir, configPath);
  assert.equal(fixture.id, "noop-js");

  await access(resolve(repoDir, "openmythos.config.json"));
});
