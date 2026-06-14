import assert from "node:assert/strict";
import test from "node:test";
import { executeShell } from "../tools/shell.js";

test("executeShell captures stdout and exit code", async () => {
  const result = await executeShell("printf openmythos", process.cwd(), 5000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "openmythos");
});
