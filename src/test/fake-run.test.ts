import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { Runner } from "../core/runner.js";
import { StateStore } from "../state/store.js";

test("Runner completes a full deterministic fake-adapter run", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-fake-run-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const result = await runner.run("fake run");
  const marker = await readFile(resolve(workdir, "openmythos-fake-output.txt"), "utf8");
  const state = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "state.json"), "utf8")) as { status: string };
  const qa = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "qa.json"), "utf8")) as { passed: boolean };

  assert.equal(result.status, "completed");
  assert.equal(marker, "OPENMYTHOS_FAKE_SUCCESS\n");
  assert.equal(state.status, "completed");
  assert.equal(qa.passed, true);
});
