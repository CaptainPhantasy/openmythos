import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeCommand } from "../tools/shell.js";
import { createWorktree, cleanupWorktree, isGitRepo, withWorktree } from "../core/worktree.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "om-wt-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function initGitRepo(dir: string): Promise<void> {
  await executeCommand("git", ["init"], dir, 10000);
  await executeCommand("git", ["config", "user.email", "test@test.com"], dir, 10000);
  await executeCommand("git", ["config", "user.name", "Test"], dir, 10000);
  await executeCommand("git", ["commit", "--allow-empty", "-m", "init"], dir, 10000);
}

describe("worktree", () => {
  it("returns non-isolated handle for non-git directory", async () => {
    await withTempDir(async (dir) => {
      const handle = await createWorktree(dir);
      assert.equal(handle.isolated, false);
      assert.equal(handle.path, dir);
    });
  });

  it("detects non-git directory", async () => {
    await withTempDir(async (dir) => {
      const result = await isGitRepo(dir);
      assert.equal(result, false);
    });
  });

  it("detects git directory", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const result = await isGitRepo(dir);
      assert.equal(result, true);
    });
  });

  it("creates isolated worktree in git repo", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const handle = await createWorktree(dir, "test-branch");
      assert.equal(handle.isolated, true);
      assert.notEqual(handle.path, dir);
      assert.equal(handle.branch, "test-branch");
      await cleanupWorktree(handle);
    });
  });

  it("withWorktree wraps creation and cleanup", async () => {
    await withTempDir(async (dir) => {
      await initGitRepo(dir);
      const result = await withWorktree(dir, async (handle) => {
        return handle.isolated ? "isolated" : "not-isolated";
      });
      assert.equal(result, "isolated");
    });
  });

  it("cleanupWorktree is safe for non-isolated handle", async () => {
    await withTempDir(async (dir) => {
      const handle = await createWorktree(dir);
      await cleanupWorktree(handle);
    });
  });
});
