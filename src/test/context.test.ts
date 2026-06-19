import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { extractRelevantSnippet, gatherContext, matchGlob } from "../context/gather.js";

test("matchGlob handles star patterns", () => {
  assert.equal(matchGlob("src/app.ts", "src/*.ts"), true);
  assert.equal(matchGlob("src/nested/app.ts", "src/*.ts"), false);
  assert.equal(matchGlob("src/nested/app.ts", "src/**/*.ts"), true);
});

test("gatherContext prioritizes relevant patterns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-context-"));
  await mkdir(resolve(dir, "src"));
  await writeFile(resolve(dir, "README.md"), "readme");
  await writeFile(resolve(dir, "src/app.ts"), "app");
  const context = await gatherContext(dir, {
    maxFiles: 2,
    maxFileSizeBytes: 1000,
    maxContextTokens: 100000,
    ignorePatterns: [],
    ignoreExtensions: []
  }, ["src/*.ts"]);

  assert.equal(context.manifest[0], "src/app.ts");
  assert.equal(context.files["src/app.ts"], "app");
});

test("gatherContext ranks files by query and extracts targeted snippets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmythos-context-"));
  await mkdir(resolve(dir, "src"), { recursive: true });
  await writeFile(resolve(dir, "src/auth.ts"), [
    "export function createSessionToken(userId: string) {",
    "  return `${userId}-token`;",
    "}",
    "",
    "export function revokeSessionToken() {",
    "  return true;",
    "}"
  ].join("\n"));
  await writeFile(resolve(dir, "src/colors.ts"), [
    "export const brandBlue = '#00f';",
    "export const brandRed = '#f00';"
  ].join("\n"));

  const context = await gatherContext(dir, {
    maxFiles: 1,
    maxFileSizeBytes: 5000,
    maxContextTokens: 100000,
    ignorePatterns: [],
    ignoreExtensions: []
  }, [], "create session token for auth");

  assert.equal(context.manifest[0], "src/auth.ts");
  assert.match(context.files["src/auth.ts"] ?? "", /createSessionToken/);
  assert.doesNotMatch(context.files["src/auth.ts"] ?? "", /brandBlue/);
});

test("extractRelevantSnippet falls back to the top of the file when no query terms match", () => {
  const snippet = extractRelevantSnippet("one\ntwo\nthree\nfour", ["missing"]);
  assert.equal(snippet, "one\ntwo\nthree\nfour");
});
