import assert from "node:assert/strict";
import test from "node:test";
import { extractJson, parseJsonFromModel } from "../core/json.js";

test("extractJson reads fenced JSON", () => {
  assert.equal(extractJson("```json\n{\"ok\":true}\n```"), "{\"ok\":true}");
});

test("parseJsonFromModel repairs trailing commas", () => {
  assert.deepEqual(parseJsonFromModel("{\"ok\":true,}"), { ok: true });
});
