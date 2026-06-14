import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { resolvePullRequestSource, summarizePullRequestVerification } from "../core/pull-requests.js";
import { Runner } from "../core/runner.js";
import { StateStore } from "../state/store.js";

test("resolvePullRequestSource reads markdown pull request files", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-pr-md-"));
  await writeFile(resolve(workdir, "pr.md"), [
    "# Fix flaky queue test",
    "",
    "Stabilize timing around queue completion."
  ].join("\n"));

  const resolved = await resolvePullRequestSource("pr.md", workdir, 5_000);

  assert.equal(resolved.pullRequest.source, "local-file");
  assert.equal(resolved.pullRequest.title, "Fix flaky queue test");
  assert.match(resolved.goal, /Resolve pull request: Fix flaky queue test/);
  assert.equal(resolved.verification.status, "warning");
});

test("resolvePullRequestSource resolves github pull requests and summarizes checks", async () => {
  const resolved = await resolvePullRequestSource("owner/repo#17", process.cwd(), 5_000, async () => ({
    command: "gh pr view",
    exitCode: 0,
    stdout: JSON.stringify({
      number: 17,
      title: "Ship queue retry guard",
      body: "Adds a backoff guard to the queue processor.",
      labels: [{ name: "backend" }],
      url: "https://github.com/owner/repo/pull/17",
      state: "OPEN",
      author: { login: "douglas" },
      baseRefName: "main",
      headRefName: "feat/queue-guard",
      reviewDecision: "REVIEW_REQUIRED",
      isDraft: false,
      statusCheckRollup: [
        { name: "unit", status: "COMPLETED", conclusion: "SUCCESS" },
        { name: "lint", status: "COMPLETED", conclusion: "FAILURE" }
      ]
    }),
    stderr: "",
    durationMs: 1
  }));

  assert.equal(resolved.pullRequest.source, "github");
  assert.equal(resolved.pullRequest.repository, "owner/repo");
  assert.equal(resolved.verification.status, "error");
  assert.deepEqual(resolved.verification.failingChecks, ["lint"]);
  assert.match(resolved.verification.summary, /failing/i);
});

test("summarizePullRequestVerification reports success when all checks pass", () => {
  const summary = summarizePullRequestVerification({
    source: "github",
    reference: "owner/repo#1",
    title: "Passes",
    body: "",
    labels: [],
    checks: [
      { name: "unit", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" }
    ]
  });

  assert.equal(summary.status, "success");
  assert.equal(summary.passed, true);
  assert.deepEqual(summary.failingChecks, []);
});

test("Runner.runFromPullRequest persists pull request artifacts", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-run-pr-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const pullRequest = {
    source: "local-file" as const,
    reference: "pr.md",
    title: "Fake pull request",
    body: "Create the deterministic marker.",
    labels: ["review"],
    checks: []
  };
  const verification = {
    status: "warning" as const,
    summary: "No external evidence available.",
    passed: null,
    failingChecks: [],
    nextActions: ["Attach a GitHub PR source for external checks."],
    artifacts: [],
    checks: []
  };

  const result = await runner.runFromPullRequest(
    pullRequest,
    "Resolve pull request: Fake pull request\n\nCreate the deterministic marker.",
    verification
  );
  const persistedPr = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "pull-request.json"), "utf8")) as {
    title: string;
  };
  const persistedVerification = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "pr-verification.json"), "utf8")) as {
    status: string;
  };

  assert.equal(result.status, "completed");
  assert.equal(persistedPr.title, "Fake pull request");
  assert.equal(persistedVerification.status, "warning");
});
