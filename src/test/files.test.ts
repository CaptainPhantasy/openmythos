import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("applyFileEdits can apply unified patch edits to existing files", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-files-"));
  const archive = resolve(workdir, "runs", "run-1");
  await mkdir(resolve(workdir, "src"), { recursive: true });
  await writeFile(resolve(workdir, "src", "patch-me.txt"), "alpha\nbeta\ngamma\n");

  await applyFileEdits(workdir, [
    {
      path: "src/patch-me.txt",
      action: "patch",
      content: "@@ -1,3 +1,3 @@\n alpha\n-beta\n+beta patched\n gamma",
      description: "patch line"
    }
  ], archive);

  assert.equal(
    await readFile(resolve(workdir, "src", "patch-me.txt"), "utf8"),
    "alpha\nbeta patched\ngamma\n"
  );
});

test("applyFileEdits rejects patch edits when the hunk does not match the target file", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-files-"));
  const archive = resolve(workdir, "runs", "run-1");
  await mkdir(resolve(workdir, "src"), { recursive: true });
  await writeFile(resolve(workdir, "src", "patch-me.txt"), "alpha\nbeta\ngamma\n");

  await assert.rejects(
    () => applyFileEdits(workdir, [
      {
        path: "src/patch-me.txt",
        action: "patch",
        content: "@@ -1,3 +1,3 @@\n alpha\n-bogus\n+beta patched\n gamma",
        description: "invalid patch line"
      }
    ], archive),
    /Patch did not match target file/
  );
});
