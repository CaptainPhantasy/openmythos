import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runSetupCheck } from "../core/setup.js";

test("runSetupCheck resolves config path relative to workdir", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-setup-check-"));
  await writeFile(resolve(workdir, "openmythos.config.json"), JSON.stringify({
    models: {
      planner: { adapter: "fake", model: "planner.fake" },
      compressor: { adapter: "fake", model: "compressor.fake" },
      coder: { adapter: "fake", model: "coder.fake" },
      critic: { adapter: "fake", model: "critic.fake" },
      verifier: { adapter: "fake", model: "verifier.fake" }
    }
  }), "utf8");

  const report = await runSetupCheck({ workdir, configPath: "openmythos.config.json" });

  assert.equal(report.configPath, resolve(workdir, "openmythos.config.json"));
  assert.equal(report.errors.every((item) => item.id !== "config-missing"), true);
});
