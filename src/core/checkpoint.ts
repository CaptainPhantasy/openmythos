// src/core/checkpoint.ts
// Git checkpoint store — immutable verified rollback points.
// Q5 invariant: on kill/replace, roll back to the last verified checkpoint;
// never inherit a dead worker's partial files.

import { executeCommand } from "../tools/shell.js";

const REF_PREFIX = "refs/omp/verified";

export interface Checkpoint {
  stepId: string;
  ref: string;
  commitSha: string;
  createdAt: number;
}

/**
 * Snapshot the current repo state as a verified checkpoint for the given step.
 * Assumes the repo is already a git repo with the worker's changes staged/committed
 * by the caller (the loop commits before checkpointing).
 */
export async function createCheckpoint(repoDir: string, stepId: string): Promise<Checkpoint> {
  const head = await executeCommand("git", ["rev-parse", "HEAD"], repoDir, 10_000);
  if (head.exitCode !== 0) {
    throw new Error(`checkpoint: HEAD resolution failed: ${head.stderr}`);
  }
  const sha = head.stdout.trim();
  const ref = `${REF_PREFIX}/${stepId}`;
  const r = await executeCommand("git", ["update-ref", ref, sha], repoDir, 10_000);
  if (r.exitCode !== 0) {
    throw new Error(`checkpoint: update-ref failed: ${r.stderr}`);
  }
  return { stepId, ref, commitSha: sha, createdAt: Date.now() };
}

/**
 * Roll the working tree back to a checkpoint. Discards everything after it
 * (the dead worker's partial work). Hard reset + clean untracked.
 */
export async function rollbackTo(repoDir: string, checkpoint: Checkpoint): Promise<void> {
  await executeCommand("git", ["reset", "--hard", checkpoint.commitSha], repoDir, 30_000);
  await executeCommand("git", ["clean", "-fdq"], repoDir, 30_000);
}

/** Commit current working-tree changes as a checkpoint point. */
export async function commitAll(repoDir: string, message: string): Promise<string | null> {
  await executeCommand("git", ["add", "-A"], repoDir, 10_000);
  await executeCommand("git", ["config", "user.email", "omp@loop"], repoDir, 5_000);
  await executeCommand("git", ["config", "user.name", "omp-loop"], repoDir, 5_000);
  const r = await executeCommand("git", ["commit", "-m", message, "--allow-empty"], repoDir, 15_000);
  if (r.exitCode !== 0 && !r.stdout.includes("nothing to commit")) {
    return null;
  }
  const head = await executeCommand("git", ["rev-parse", "HEAD"], repoDir, 10_000);
  return head.exitCode === 0 ? head.stdout.trim() : null;
}

/** Ensure repo is initialized. Idempotent. */
export async function ensureGitRepo(repoDir: string): Promise<void> {
  await executeCommand("git", ["init", "-q"], repoDir, 10_000);
}
