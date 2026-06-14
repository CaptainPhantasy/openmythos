import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { gatherContext, matchGlob } from "../context/gather.js";

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
    ignorePatterns: [],
    ignoreExtensions: []
  }, ["src/*.ts"]);

  assert.equal(context.manifest[0], "src/app.ts");
  assert.equal(context.files["src/app.ts"], "app");
});
