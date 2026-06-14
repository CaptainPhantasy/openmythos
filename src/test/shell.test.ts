import assert from "node:assert/strict";
import test from "node:test";
import { executeCommand, executeShell } from "../tools/shell.js";

test("executeShell captures stdout and exit code", async () => {
  const result = await executeShell("printf openmythos", process.cwd(), 5000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "openmythos");
});

test("executeCommand captures stdout and exit code", async () => {
  const result = await executeCommand("printf", ["openmythos"], process.cwd(), 5000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "openmythos");
});
