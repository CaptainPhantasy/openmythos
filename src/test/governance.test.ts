import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { evaluateGovernance } from "../core/governance.js";
import { Runner } from "../core/runner.js";
import { StateStore } from "../state/store.js";
import { executeCommand } from "../tools/shell.js";

test("evaluateGovernance blocks protected branches when configured", async () => {
  const repo = await mkdtemp(join(tmpdir(), "openmythos-governance-"));
  await git(repo, "init");
  await git(repo, "config", "user.email", "test@example.com");
  await git(repo, "config", "user.name", "OpenMythos Test");
  await writeFile(resolve(repo, "tracked.txt"), "hello\n");
  await git(repo, "add", "tracked.txt");
  await git(repo, "commit", "-m", "init");
  await git(repo, "branch", "-M", "main");

  const config = await loadConfigWithOptionalProfile(resolve("/Volumes/Storage/OpenMythos/openmythos.config.json"), "fake");
  config.governance.protectedBranchMode = "block";
  config.governance.protectedBranches = ["main"];

  const report = await evaluateGovernance(config, repo);
  assert.equal(report.blocked, true);
  assert.equal(report.branch, "main");
  assert.deepEqual(report.issues.map((issue) => issue.code), ["protected_branch"]);
});

test("Runner records governance failure before model phases", async () => {
  const repo = await mkdtemp(join(tmpdir(), "openmythos-governance-run-"));
  await git(repo, "init");
  await git(repo, "config", "user.email", "test@example.com");
  await git(repo, "config", "user.name", "OpenMythos Test");
  await writeFile(resolve(repo, "tracked.txt"), "hello\n");
  await git(repo, "add", "tracked.txt");
  await git(repo, "commit", "-m", "init");
  await git(repo, "branch", "-M", "main");

  const config = await loadConfigWithOptionalProfile(resolve("/Volumes/Storage/OpenMythos/openmythos.config.json"), "fake");
  config.governance.protectedBranchMode = "block";
  config.governance.protectedBranches = ["main"];

  const runner = new Runner(config, new StateStore(resolve(repo, "runs")), repo);
  const result = await runner.run("blocked by governance");
  const state = JSON.parse(await readFile(resolve(repo, "runs", result.runId, "state.json"), "utf8")) as {
    status: string;
    error: string | null;
  };
  const governance = JSON.parse(await readFile(resolve(repo, "runs", result.runId, "governance.json"), "utf8")) as {
    blocked: boolean;
    branch: string;
    issues: Array<{ code: string }>;
  };

  assert.equal(result.status, "failed");
  assert.equal(state.status, "failed");
  assert.match(state.error ?? "", /protected branch policy/i);
  assert.equal(governance.blocked, true);
  assert.equal(governance.branch, "main");
  assert.deepEqual(governance.issues.map((issue) => issue.code), ["protected_branch"]);
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await executeCommand("git", args, cwd, 15_000);
  assert.equal(result.exitCode, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
}
