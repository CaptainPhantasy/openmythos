import assert from "node:assert/strict";
import test from "node:test";
import { trimOrEmpty } from "./trim.js";

test("trimOrEmpty trims whitespace from each item", () => {
  assert.deepEqual(trimOrEmpty([" a ", " b ", "" ]), ["a", "b", ""]);
});

test("trimOrEmpty filters nothing", () => {
  assert.deepEqual(trimOrEmpty([" x", "y ", "  z  "]), ["x", "y", "z"]);
});
