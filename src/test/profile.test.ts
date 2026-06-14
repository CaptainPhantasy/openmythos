import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadConfigWithOptionalProfile } from "../config/profile.js";

test("loadConfigWithOptionalProfile applies profile overlays from config directory", async () => {
  const config = await loadConfigWithOptionalProfile(
    resolve("openmythos.config.json"),
    "fake"
  );

  assert.equal(config.models.planner.adapter, "fake");
  assert.equal(config.models.coder.model, "fake-openmythos");
  assert.equal(config.verification.localCommands.length, 2);
});
