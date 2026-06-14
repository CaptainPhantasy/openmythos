import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { executeCommand } from "../tools/shell.js";

export interface WorktreeHandle {
  path: string;
  branch: string;
  repoRoot: string;
  isolated: boolean;
}

export async function isGitRepo(repoRoot: string): Promise<boolean> {
  const result = await executeCommand("git", ["rev-parse", "--git-dir"], repoRoot, 10000);
  return result.exitCode === 0;
}

export async function createWorktree(
  repoRoot: string,
  branchName?: string
): Promise<WorktreeHandle> {
  const gitRepo = await isGitRepo(repoRoot);
  if (!gitRepo) {
    return { path: repoRoot, branch: "", repoRoot, isolated: false };
  }

  const branch = branchName ?? `openmythos/task-${Date.now()}`;
  const worktreeBase = resolve(repoRoot, ".openmythos", "worktrees");
  const worktreePath = join(worktreeBase, branch.replace(/[^a-zA-Z0-9._-]/g, "-"));

  await mkdir(worktreePath, { recursive: true });

  const result = await executeCommand(
    "git",
    ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
    repoRoot,
    30000
  );

  if (result.exitCode !== 0) {
    await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    return { path: repoRoot, branch: "", repoRoot, isolated: false };
  }

  return { path: worktreePath, branch, repoRoot, isolated: true };
}

export async function cleanupWorktree(
  handle: WorktreeHandle,
  deleteBranch = true
): Promise<void> {
  if (!handle.isolated) return;

  await executeCommand(
    "git",
    ["worktree", "remove", "--force", handle.path],
    handle.repoRoot,
    15000
  ).catch(() => {});

  if (deleteBranch && handle.branch) {
    await executeCommand(
      "git",
      ["branch", "-D", handle.branch],
      handle.repoRoot,
      10000
    ).catch(() => {});
  }

  await rm(handle.path, { recursive: true, force: true }).catch(() => {});
}

export async function withWorktree<T>(
  repoRoot: string,
  fn: (handle: WorktreeHandle) => Promise<T>,
  options?: { branchName?: string; deleteBranch?: boolean }
): Promise<T> {
  const handle = await createWorktree(repoRoot, options?.branchName);
  try {
    return await fn(handle);
  } finally {
    await cleanupWorktree(handle, options?.deleteBranch ?? true);
  }
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeHandle[]> {
  const gitRepo = await isGitRepo(repoRoot);
  if (!gitRepo) return [];

  const result = await executeCommand(
    "git",
    ["worktree", "list", "--porcelain"],
    repoRoot,
    10000
  );
  if (result.exitCode !== 0) return [];

  const handles: WorktreeHandle[] = [];
  const blocks = result.stdout.trim().split("\n\n");
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const pathLine = lines.find((l) => l.startsWith("worktree "));
    const branchLine = lines.find((l) => l.startsWith("branch "));
    if (pathLine) {
      const path = pathLine.slice("worktree ".length);
      const branch = branchLine ? branchLine.slice("branch ".length).replace("refs/heads/", "") : "";
      handles.push({ path, branch, repoRoot, isolated: path !== repoRoot });
    }
  }
  return handles;
}
