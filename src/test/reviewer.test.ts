import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { buildReviewMarkdown, collectGitReviewInput, runReview } from "../core/reviewer.js";
import { executeCommand } from "../tools/shell.js";

test("collectGitReviewInput captures modified and untracked files from a git worktree", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), "openmythos-review-input-")));
  await git(repo, "init");
  await git(repo, "config", "user.email", "test@example.com");
  await git(repo, "config", "user.name", "OpenMythos Test");
  await writeFile(resolve(repo, "tracked.ts"), "export const value = 1;\n");
  await git(repo, "add", "tracked.ts");
  await git(repo, "commit", "-m", "init");

  await writeFile(resolve(repo, "tracked.ts"), "export const value = 2;\n");
  await writeFile(resolve(repo, "new.ts"), "export const created = true;\n");

  const input = await collectGitReviewInput(repo);
  const changedPaths = input.changedFiles.map((file) => `${file.status}:${file.path}`);

  assert.equal(input.repoRoot, repo);
  assert.match(input.diff, /tracked\.ts/);
  assert.deepEqual(changedPaths, ["??:new.ts", "M:tracked.ts"]);
  assert.equal(input.changedFiles[0]?.content, "export const created = true;\n");
  assert.equal(input.changedFiles[1]?.content, "export const value = 2;\n");
});

test("buildReviewMarkdown renders ordered findings and scope", () => {
  const markdown = buildReviewMarkdown({
    generatedAt: "2026-06-14T00:00:00.000Z",
    input: {
      repoRoot: "/tmp/demo",
      statusText: " M src/app.ts",
      diff: "diff --git a/src/app.ts b/src/app.ts",
      changedFiles: [
        {
          path: "src/app.ts",
          status: "M",
          content: "export const app = true;\n"
        }
      ]
    },
    result: {
      verdict: "issues_found",
      summary: "One correctness issue found.",
      findings: [
        {
          severity: "minor",
          description: "Minor note."
        },
        {
          severity: "critical",
          description: "Breaks runtime.",
          file: "src/app.ts",
          line: 12,
          suggestedFix: "Restore the removed guard."
        }
      ],
      strengths: ["Focused diff scope."]
    }
  });

  assert.match(markdown, /Verdict: issues_found/);
  assert.match(markdown, /\[critical\] Breaks runtime\.\s+\(src\/app\.ts:12\)/);
  assert.match(markdown, /fix: Restore the removed guard\./);
  assert.match(markdown, /- M src\/app\.ts/);
});

test("runReview writes JSON and markdown artifacts", async () => {
  const repo = await mkdtemp(join(tmpdir(), "openmythos-review-run-"));
  await git(repo, "init");
  await git(repo, "config", "user.email", "test@example.com");
  await git(repo, "config", "user.name", "OpenMythos Test");
  await writeFile(resolve(repo, "tracked.ts"), "export const value = 1;\n");
  await git(repo, "add", "tracked.ts");
  await git(repo, "commit", "-m", "init");
  await writeFile(resolve(repo, "tracked.ts"), "export const value = 2;\n");

  const config = await loadConfigWithOptionalProfile(resolve("/Volumes/Storage/OpenMythos/openmythos.config.json"), "fake");
  const review = await runReview(config, repo, { outputDir: ".reviews-test" });
  const json = JSON.parse(await readFile(review.artifacts.jsonPath, "utf8")) as {
    result: { verdict: string };
  };
  const markdown = await readFile(review.artifacts.markdownPath, "utf8");

  assert.equal(review.result.verdict, "clean");
  assert.equal(json.result.verdict, "clean");
  assert.match(markdown, /OpenMythos Review Report/);
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await executeCommand("git", args, cwd, 15_000);
  assert.equal(result.exitCode, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
}
