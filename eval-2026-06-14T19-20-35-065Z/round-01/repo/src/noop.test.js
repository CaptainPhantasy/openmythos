import assert from "node:assert/strict";
import test from "node:test";
import { echoOrFallback } from "./noop.js";

test("echoOrFallback returns the provided non-empty string", () => {
  assert.equal(echoOrFallback("openmythos"), "openmythos");
});

test("echoOrFallback falls back when the input is blank", () => {
  assert.equal(echoOrFallback("   "), "fallback");
});
