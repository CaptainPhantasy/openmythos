import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfig } from "../config/load.js";

test("loadConfig validates a minimal valid config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-config-"));
  const path = resolve(dir, "config.json");
  await writeFile(path, JSON.stringify({
    models: {
      planner: { adapter: "openai", model: "a" },
      compressor: { adapter: "openai", model: "b" },
      coder: { adapter: "openai", model: "c" },
      critic: { adapter: "openai", model: "d" },
      verifier: { adapter: "openai", model: "e" }
    }
  }));

  const config = await loadConfig(path);
  assert.equal(config.execution.maxRetries, 3);
  assert.equal(config.models.planner.maxTokens, 4096);
  assert.equal(config.approval.mode, "off");
  assert.equal(config.governance.dirtyWorktree, "warn");
});
