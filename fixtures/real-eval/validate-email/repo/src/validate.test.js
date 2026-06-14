import assert from "node:assert/strict";
import test from "node:test";
import { isValidEmail } from "./validate.js";

test("isValidEmail accepts standard email addresses", () => {
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("test.name@domain.org"), true);
});

test("isValidEmail rejects missing @ symbol", () => {
  assert.equal(isValidEmail("userexample.com"), false);
});

test("isValidEmail rejects missing domain", () => {
  assert.equal(isValidEmail("user@"), false);
});

test("isValidEmail rejects empty strings", () => {
  assert.equal(isValidEmail(""), false);
});
