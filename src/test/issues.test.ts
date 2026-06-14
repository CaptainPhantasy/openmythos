import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { resolveIssueSource } from "../core/issues.js";
import { Runner } from "../core/runner.js";
import { StateStore } from "../state/store.js";

test("resolveIssueSource reads markdown issue files", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-issue-md-"));
  await writeFile(resolve(workdir, "issue.md"), [
    "# Fix auth regression",
    "",
    "Login fails when the session cookie is missing.",
    "",
    "- reproduce with expired session",
    "- add regression coverage"
  ].join("\n"));

  const resolved = await resolveIssueSource("issue.md", workdir, 5_000);

  assert.equal(resolved.issue.source, "local-file");
  assert.equal(resolved.issue.title, "Fix auth regression");
  assert.match(resolved.goal, /Resolve issue: Fix auth regression/);
  assert.match(resolved.goal, /Login fails when the session cookie is missing/);
});

test("resolveIssueSource reads json issue files", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-issue-json-"));
  await writeFile(resolve(workdir, "issue.json"), JSON.stringify({
    title: "Refactor queue worker",
    description: "The worker should stop polling when the queue is empty.",
    labels: ["tech-debt", "backend"]
  }, null, 2));

  const resolved = await resolveIssueSource("issue.json", workdir, 5_000);

  assert.equal(resolved.issue.title, "Refactor queue worker");
  assert.deepEqual(resolved.issue.labels, ["tech-debt", "backend"]);
  assert.match(resolved.goal, /Labels: tech-debt, backend/);
});

test("resolveIssueSource resolves github issue refs through gh", async () => {
  const resolved = await resolveIssueSource("owner/repo#42", process.cwd(), 5_000, async () => ({
    command: "gh issue view",
    exitCode: 0,
    stdout: JSON.stringify({
      number: 42,
      title: "Queue timeout",
      body: "The queue processor stalls under load.",
      labels: [{ name: "bug" }, { name: "urgent" }],
      url: "https://github.com/owner/repo/issues/42",
      state: "OPEN",
      author: { login: "douglas" }
    }),
    stderr: "",
    durationMs: 1
  }));

  assert.equal(resolved.issue.source, "github");
  assert.equal(resolved.issue.repository, "owner/repo");
  assert.equal(resolved.issue.number, 42);
  assert.deepEqual(resolved.issue.labels, ["bug", "urgent"]);
  assert.match(resolved.goal, /Resolve issue: Queue timeout/);
});

test("Runner.runFromIssue persists issue artifact and completes fake run", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "openmythos-run-issue-"));
  const config = await loadConfigWithOptionalProfile(resolve("openmythos.config.json"), "fake");
  const runner = new Runner(config, new StateStore(resolve(workdir, "runs")), workdir);

  const issue = {
    source: "local-file" as const,
    reference: "issue.md",
    title: "Fake issue",
    body: "Create the deterministic marker.",
    labels: ["test"]
  };

  const result = await runner.runFromIssue(issue, "Resolve issue: Fake issue\n\nCreate the deterministic marker.");
  const persisted = JSON.parse(await readFile(resolve(workdir, "runs", result.runId, "issue.json"), "utf8")) as {
    title: string;
    body: string;
  };

  assert.equal(result.status, "completed");
  assert.equal(persisted.title, "Fake issue");
  assert.equal(persisted.body, "Create the deterministic marker.");
});
