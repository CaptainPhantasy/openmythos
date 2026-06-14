import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { applyFileEdits } from "../tools/files.js";

test("applyFileEdits creates, modifies, and archives deletes", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-files-"));
  const archive = resolve(workdir, "runs", "run-1");
  await applyFileEdits(workdir, [
    { path: "src/a.txt", action: "create", content: "one", description: "create" },
    { path: "src/a.txt", action: "modify", content: "two", description: "modify" }
  ], archive);

  assert.equal(await readFile(resolve(workdir, "src/a.txt"), "utf8"), "two");

  await writeFile(resolve(workdir, "delete-me.txt"), "keep me");
  await applyFileEdits(workdir, [
    { path: "delete-me.txt", action: "delete", content: "", description: "archive delete" }
  ], archive);

  assert.equal(await readFile(resolve(archive, "deleted-files", "delete-me.txt"), "utf8"), "keep me");
});

test("applyFileEdits rejects path escape", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-files-"));
  await assert.rejects(
    () => applyFileEdits(workdir, [
      { path: "../escape.txt", action: "create", content: "bad", description: "bad" }
    ], resolve(workdir, "runs", "run-1")),
    /outside workdir/
  );
});
