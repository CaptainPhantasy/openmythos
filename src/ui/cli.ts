import { Command } from "commander";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { resolveIssueSource } from "../core/issues.js";
import { collectRunMetrics, summarizeBench } from "../core/metrics.js";
import { resolvePullRequestSource } from "../core/pull-requests.js";
import { buildReadinessReport } from "../core/readiness.js";
import {
  assessRealEvalFixture,
  copyRealEvalFixture,
  initializeRealEvalRepository,
  loadRealEvalFixture,
  loadRealEvalSuite,
  usesFakeAdapter,
  snapshotModelBindings,
  type RealEvalFixture,
  type RealEvalRoundResult,
  type RealEvalModelBinding,
  type RealEvalResult
} from "../core/real-eval.js";
import { runSetupCheck } from "../core/setup.js";
import { runReview } from "../core/reviewer.js";
import { Runner } from "../core/runner.js";
import { StateStore } from "../state/store.js";
import { executeCommand, executeShell } from "../tools/shell.js";
import { runTui } from "./tui.js";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("openmythos")
    .description("Deterministic multi-model orchestration harness")
    .version("0.20.0");

  program.command("run")
    .argument("<goal>", "Goal to execute")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (goal: string, options: { config: string; profile?: string; workdir: string }) => {
      const { runner } = await runtime(options.config, options.workdir, options.profile);
      const result = await runner.run(goal);
      console.log(JSON.stringify(result, null, 2));
    });

  program.command("session")
    .argument("<goal>", "Goal to execute in daily-driver mode")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--tui", "Open the TUI after the run starts")
    .action(async (
      goal: string,
      options: {
        config: string;
        profile?: string;
        workdir: string;
        tui?: boolean;
      }
    ) => {
      const { runner, store } = await runtime(options.config, options.workdir, options.profile);
      const result = await runner.run(goal);
      console.log(JSON.stringify(result, null, 2));

      if (options.tui) {
        await runTui(store, false);
      }
      if (result.status !== "completed" && result.status !== "awaiting_approval") {
        process.exitCode = 1;
      }
    });

  program.command("approve")
    .description("Approve an awaiting_approval run and continue execution")
    .argument("<runId>", "Run id")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string, options: { config: string; profile?: string; workdir: string }) => {
      const { runner } = await runtime(options.config, options.workdir, options.profile);
      const result = await runner.approve(runId);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "completed" && result.status !== "awaiting_approval") {
        process.exitCode = 1;
      }
    });

  program.command("reject")
    .description("Reject a run and fail it")
    .argument("<runId>", "Run id")
    .argument("[reason...]", "Reason for rejection")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string, reasonParts: string[], options: { config: string; profile?: string; workdir: string }) => {
      const { runner } = await runtime(options.config, options.workdir, options.profile);
      const reason = reasonParts.length > 0 ? reasonParts.join(" ") : "Rejected by operator.";
      const result = await runner.reject(runId, reason);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "failed") {
        process.exitCode = 1;
      }
    });

  program.command("cancel")
    .description("Cancel a run and mark it as failed")
    .argument("<runId>", "Run id")
    .argument("[reason...]", "Optional reason for cancellation")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string, reasonParts: string[], options: { config: string; profile?: string; workdir: string }) => {
      const { runner } = await runtime(options.config, options.workdir, options.profile);
      const reason = reasonParts.length > 0 ? reasonParts.join(" ") : "Cancelled by operator.";
      const result = await runner.cancel(runId, reason);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "failed") {
        process.exitCode = 1;
      }
    });

  program.command("queue")
    .description("Queue a run for replay from the beginning")
    .argument("<runId>", "Run id")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string, options: { config: string; profile?: string; workdir: string }) => {
      const { runner } = await runtime(options.config, options.workdir, options.profile);
      const result = await runner.queue(runId);
      console.log(JSON.stringify(result, null, 2));
    });

  program.command("replay")
    .description("Queue and rerun a run from the beginning")
    .argument("<runId>", "Run id")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string, options: { config: string; profile?: string; workdir: string }) => {
      const { runner } = await runtime(options.config, options.workdir, options.profile);
      const result = await runner.replay(runId);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "completed" && result.status !== "awaiting_approval") {
        process.exitCode = 1;
      }
    });

  program.command("resume")
    .argument("<runId>", "Run id")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string, options: { config: string; profile?: string; workdir: string }) => {
      const { runner } = await runtime(options.config, options.workdir, options.profile);
      const result = await runner.resume(runId);
      console.log(JSON.stringify(result, null, 2));
    });

  program.command("run-issue")
    .argument("<source>", "Issue source: local file, issue number, owner/repo#number, or GitHub issue URL")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (source: string, options: { config: string; profile?: string; workdir: string }) => {
      const { runner, config } = await runtime(options.config, options.workdir, options.profile);
      const resolved = await resolveIssueSource(source, resolve(options.workdir), config.execution.timeoutMs);
      const result = await runner.runFromIssue(resolved.issue, resolved.goal);
      console.log(JSON.stringify({
        issue: resolved.issue,
        goal: resolved.goal,
        result
      }, null, 2));
    });

  program.command("issue")
    .description("Resolve an issue source into canonical harness input")
    .argument("<source>", "Issue source: local file, issue number, owner/repo#number, or GitHub issue URL")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (source: string, options: { config: string; profile?: string; workdir: string }) => {
      const { config } = await runtime(options.config, options.workdir, options.profile);
      const resolved = await resolveIssueSource(source, resolve(options.workdir), config.execution.timeoutMs);
      console.log(JSON.stringify(resolved, null, 2));
    });

  program.command("run-pr")
    .argument("<source>", "Pull request source: local file, PR number, owner/repo#number, or GitHub PR URL")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (source: string, options: { config: string; profile?: string; workdir: string }) => {
      const { runner, config } = await runtime(options.config, options.workdir, options.profile);
      const resolved = await resolvePullRequestSource(source, resolve(options.workdir), config.execution.timeoutMs);
      const result = await runner.runFromPullRequest(resolved.pullRequest, resolved.goal, resolved.verification);
      console.log(JSON.stringify({
        pullRequest: resolved.pullRequest,
        goal: resolved.goal,
        verification: resolved.verification,
        result
      }, null, 2));
    });

  program.command("pr")
    .description("Resolve a pull request source into canonical harness input")
    .argument("<source>", "Pull request source: local file, PR number, owner/repo#number, or GitHub PR URL")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (source: string, options: { config: string; profile?: string; workdir: string }) => {
      const { config } = await runtime(options.config, options.workdir, options.profile);
      const resolved = await resolvePullRequestSource(source, resolve(options.workdir), config.execution.timeoutMs);
      console.log(JSON.stringify(resolved, null, 2));
    });

  program.command("verify-pr")
    .description("Collect external verification evidence for a pull request source")
    .argument("<source>", "Pull request source: local file, PR number, owner/repo#number, or GitHub PR URL")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (source: string, options: { config: string; profile?: string; workdir: string }) => {
      const { config } = await runtime(options.config, options.workdir, options.profile);
      const resolved = await resolvePullRequestSource(source, resolve(options.workdir), config.execution.timeoutMs);
      console.log(JSON.stringify(resolved.verification, null, 2));
      if (resolved.verification.status === "error") {
        process.exitCode = 1;
      }
    });

  program.command("branch")
    .description("Manage local git branches")
    .argument("[name]", "Branch name")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--list", "List local branches")
    .option("--current", "Show the current branch name")
    .option("--create", "Create a branch")
    .option("--switch", "Switch to a branch")
    .option("--delete", "Delete a branch")
    .option("--force", "Force delete a branch")
    .action(async (name: string | undefined, options: {
      workdir: string;
      list?: boolean;
      current?: boolean;
      create?: boolean;
      switch?: boolean;
      delete?: boolean;
      force?: boolean;
    }) => {
      const workdir = resolve(options.workdir);
      const requestedModeCount = Number(Boolean(options.create)) + Number(Boolean(options.switch)) + Number(Boolean(options.delete));
      if (options.current) {
        const result = await executeCommand("git", ["branch", "--show-current"], workdir, 120000);
        console.log(JSON.stringify({
          action: "branch.current",
          status: result.exitCode === 0 ? "ok" : "failed",
          branch: result.stdout.trim() || null,
          output: sanitizeCommandOutput(result.stdout, result.stderr)
        }, null, 2));
        if (result.exitCode !== 0) {
          process.exitCode = 1;
        }
        return;
      }

      if (options.list || (!name && requestedModeCount === 0 && !options.create && !options.switch && !options.delete)) {
        const result = await executeCommand("git", ["branch", "--color=never"], workdir, 120000);
        console.log(JSON.stringify({
          action: "branch.list",
          status: result.exitCode === 0 ? "ok" : "failed",
          branches: result.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
        }, null, 2));
        if (result.exitCode !== 0) {
          process.exitCode = 1;
        }
        return;
      }

      if (requestedModeCount > 1) {
        console.error("branch requires only one mode at a time: --create, --switch, --delete");
        process.exitCode = 1;
        return;
      }

      if (!name) {
        console.error("branch name is required for create, switch, and delete actions");
        process.exitCode = 1;
        return;
      }

      if (options.delete) {
        const result = await executeCommand("git", ["branch", options.force ? "-D" : "-d", name], workdir, 120000);
        console.log(JSON.stringify({
          action: options.force ? "branch.delete-force" : "branch.delete",
          status: result.exitCode === 0 ? "ok" : "failed",
          branch: name,
          output: sanitizeCommandOutput(result.stdout, result.stderr)
        }, null, 2));
        if (result.exitCode !== 0) {
          process.exitCode = 1;
        }
        return;
      }

      const command = options.switch ? ["switch", name] : ["branch", name];
      if (options.create && requestedModeCount === 0) {
        command.pop();
        command.push(name);
      }

      const result = await executeCommand("git", options.create ? ["branch", name] : command, workdir, 120000);
      console.log(JSON.stringify({
        action: options.switch ? "branch.switch" : "branch.create",
        status: result.exitCode === 0 ? "ok" : "failed",
        branch: name,
        output: sanitizeCommandOutput(result.stdout, result.stderr)
      }, null, 2));
      if (result.exitCode !== 0) {
        process.exitCode = 1;
      }
    });

  program.command("stage")
    .description("Stage and unstage repository paths")
    .argument("<paths...>", "Paths to stage (or unstage with --unstage)")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--unstage", "Unstage the listed paths")
    .action(async (paths: string[], options: { workdir: string; unstage?: boolean; }) => {
      const args = options.unstage
        ? ["restore", "--staged", "--", ...paths]
        : ["add", "--", ...paths];
      const result = await executeCommand("git", args, resolve(options.workdir), 120000);
      console.log(JSON.stringify({
        action: options.unstage ? "stage.unstage" : "stage.add",
        status: result.exitCode === 0 ? "ok" : "failed",
        paths,
        output: sanitizeCommandOutput(result.stdout, result.stderr)
      }, null, 2));
      if (result.exitCode !== 0) {
        process.exitCode = 1;
      }
    });

  program.command("commit")
    .description("Create a repository commit")
    .option("-m, --message <text>", "Commit message", "work-item update")
    .option("--allow-empty", "Allow an empty commit")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (options: { message: string; allowEmpty?: boolean; workdir: string; }) => {
      const message = options.message.trim() || "work-item update";
      const result = await executeCommand(
        "git",
        options.allowEmpty ? ["commit", "-m", message, "--allow-empty"] : ["commit", "-m", message],
        resolve(options.workdir),
        120000
      );
      const commit = await executeCommand("git", ["rev-parse", "HEAD"], resolve(options.workdir), 120000);
      console.log(JSON.stringify({
        action: "commit",
        status: result.exitCode === 0 ? "ok" : "failed",
        message,
        commit: commit.exitCode === 0 ? commit.stdout.trim() : null,
        output: sanitizeCommandOutput(result.stdout, result.stderr)
      }, null, 2));
      if (result.exitCode !== 0) {
        process.exitCode = 1;
      }
    });

  program.command("rollback")
    .description("Rollback working state for repository recovery")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("-t, --target <ref>", "Reset target", "HEAD")
    .option("--clean", "Clean untracked files")
    .option("--hard", "Use hard reset")
    .option("--force", "Confirm destructive rollback operations")
    .action(async (options: {
      workdir: string;
      target: string;
      clean?: boolean;
      hard?: boolean;
      force?: boolean;
    }) => {
      const workdir = resolve(options.workdir);
      if ((options.hard || options.clean) && !options.force) {
        console.error("rollback --force is required for --hard and --clean");
        process.exitCode = 1;
        return;
      }
      const mode = options.hard ? "--hard" : "--soft";
      const reset = await executeCommand("git", ["reset", mode, options.target], workdir, 120000);
      const clean = options.clean
        ? await executeCommand("git", ["clean", "-fd"], workdir, 120000)
        : null;
      const status = await executeCommand("git", ["status", "--short", "--branch"], workdir, 120000);
      console.log(JSON.stringify({
        action: "rollback",
        status: reset.exitCode === 0 && status.exitCode === 0 && !(options.clean && clean?.exitCode !== 0) ? "ok" : "failed",
        mode,
        target: options.target,
        resetOutput: sanitizeCommandOutput(reset.stdout, reset.stderr),
        cleanOutput: clean === null ? null : sanitizeCommandOutput(clean.stdout, clean.stderr),
        workingTree: status.stdout.trim()
      }, null, 2));
      if (reset.exitCode !== 0 || status.exitCode !== 0 || (options.clean && clean?.exitCode !== 0)) {
        process.exitCode = 1;
      }
    });

  program.command("publish-pr")
    .description("Prepare or publish a PR from the current branch")
    .option("-t, --title <text>", "PR title", "OpenMythos PR")
    .option("-b, --body <text>", "PR body", "Created with OpenMythos")
    .option("--base <branch>", "PR base branch", "main")
    .option("--dry-run", "Print only the gh command to run")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (options: { title: string; body: string; base: string; dryRun: boolean; workdir: string; }) => {
      const workdir = resolve(options.workdir);
      const command = `gh pr create --base ${shellQuote(options.base)} --title ${shellQuote(options.title)} --body ${shellQuote(options.body)}`;
      const hasGh = await executeCommand("gh", ["--version"], workdir, 120000);
      if (hasGh.exitCode !== 0) {
        console.log(JSON.stringify({
          action: "publish-pr",
          status: "failed",
          reason: "gh CLI missing",
          command
        }, null, 2));
        process.exitCode = 1;
        return;
      }
      if (options.dryRun) {
        console.log(JSON.stringify({
          action: "publish-pr",
          status: "ready",
          command
        }, null, 2));
        return;
      }
      const result = await executeCommand("sh", ["-c", command], workdir, 120000);
      console.log(JSON.stringify({
        action: "publish-pr",
        status: result.exitCode === 0 ? "ok" : "failed",
        command,
        output: sanitizeCommandOutput(result.stdout, result.stderr)
      }, null, 2));
      if (result.exitCode !== 0) {
        process.exitCode = 1;
      }
    });

  program.command("release-check")
    .description("Run release gate checks and emit a retained report")
    .option("-w, --workdir <path>", "Target repository root", ".")
    .option("--output <path>", "Write report to this path")
    .option("--skip-tests", "Skip npm test while checking")
    .action(async (options: {
      workdir: string;
      output?: string;
      skipTests?: boolean;
    }) => {
      const workdir = resolve(options.workdir);
      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

      const build = await executeShell("npm run build", workdir, 120000);
      checks.push({
        name: "build",
        passed: build.exitCode === 0,
        detail: build.exitCode === 0 ? "npm run build" : sanitizeCommandOutput(build.stdout, build.stderr)
      });

      const test = options.skipTests
        ? { exitCode: 0, stdout: "skipped by --skip-tests", stderr: "" }
        : await executeShell("npm test", workdir, 120000);
      checks.push({
        name: options.skipTests ? "test (skipped)" : "test",
        passed: test.exitCode === 0,
        detail: test.exitCode === 0 ? "npm test" : sanitizeCommandOutput(test.stdout, test.stderr)
      });

      const readiness = await buildReadinessReport(workdir);
      checks.push({
        name: "readiness",
        passed: readiness.summary.missingEvidenceCount === 0 && readiness.summary.partialCount === 0 && readiness.summary.unprovenCount === 0,
        detail: `missingEvidence=${readiness.summary.missingEvidenceCount}, partialGoals=${readiness.summary.partialCount}, unprovenGoals=${readiness.summary.unprovenCount}`
      });

      const status = await executeCommand("git", ["status", "--short"], workdir, 120000);
      const releaseReady = checks.every((entry) => entry.passed);
      const report = {
        schemaVersion: "release-check.v1",
        generatedAt: new Date().toISOString(),
        workdir,
        checks,
        readinessSummary: readiness.summary,
        git: {
          hasChanges: status.stdout.trim().length > 0,
          status: sanitizeCommandOutput(status.stdout)
        }
      };
      const payload = JSON.stringify(report, null, 2);
      const outputPath = resolve(workdir, options.output ?? "release-check.json");
      await writeFile(outputPath, payload, "utf8");
      console.log(payload);
      if (!releaseReady) {
        process.exitCode = 1;
      }
    });

  program.command("eval")
    .description("Run consecutive deterministic harness evaluation rounds")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay", "fake")
    .option("-r, --rounds <n>", "Consecutive rounds required", parsePositiveInt, 10)
    .option("-w, --workdir <path>", "Evaluation output directory", "runs/evals")
    .option("-g, --goal <goal>", "Evaluation goal", "deterministic fake eval round")
    .action(async (options: { config: string; profile: string; rounds: number; workdir: string; goal: string }) => {
      const evalRoot = resolve(options.workdir, `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await mkdir(evalRoot, { recursive: true });
      const results: Array<{ round: number; status: string; runId?: string; workdir: string; error?: string }> = [];

      for (let round = 1; round <= options.rounds; round++) {
        const roundWorkdir = resolve(evalRoot, `round-${String(round).padStart(2, "0")}`);
        await mkdir(roundWorkdir, { recursive: true });
        try {
          const { runner } = await runtime(options.config, roundWorkdir, options.profile);
          const result = await runner.run(`${options.goal} ${round}`);
          results.push({ round, status: result.status, runId: result.runId, workdir: roundWorkdir });
          if (result.status !== "completed") {
            break;
          }
        } catch (error) {
          results.push({ round, status: "failed", workdir: roundWorkdir, error: (error as Error).message });
          break;
        }
      }

      const passed = results.length === options.rounds && results.every((result) => result.status === "completed");
      const summary = {
        schemaVersion: "eval.v1",
        evidenceLevel: "smoke",
        passed,
        requiredConsecutiveRounds: options.rounds,
        successfulConsecutiveRounds: countLeadingCompleted(results),
        profile: options.profile,
        evalRoot,
        mode: "marker",
        results
      };
      await writeFile(resolve(evalRoot, "summary.json"), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
      if (!passed) {
        process.exitCode = 1;
      }
    });

  program.command("real-eval")
    .description("Run retained real repository benchmark rounds against a fixture repo (alias for live-eval)")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-f, --fixture <id>", "Real eval fixture id", "noop-js")
    .option("-r, --rounds <n>", "Consecutive rounds required", parsePositiveInt, 1)
    .option("-w, --workdir <path>", "Real evaluation output directory", "runs/real-evals")
    .option("-g, --goal <goal>", "Override the fixture goal")
    .action(async (options: { config: string; profile?: string; fixture: string; rounds: number; workdir: string; goal?: string }) => {
      await runLiveEvalCommand({
        config: options.config,
        profile: options.profile,
        fixture: options.fixture,
        rounds: options.rounds,
        workdir: options.workdir,
        goal: options.goal
      });
    });

  program.command("live-eval")
    .description("Run a retained real repository benchmark round against a fixture repo")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-f, --fixture <id>", "Real eval fixture id", "noop-js")
    .option("-r, --rounds <n>", "Consecutive rounds required", parsePositiveInt, 1)
    .option("-w, --workdir <path>", "Real evaluation output directory", "runs/real-evals")
    .option("-g, --goal <goal>", "Override the fixture goal")
    .action(async (options: { config: string; profile?: string; fixture: string; rounds: number; workdir: string; goal?: string }) => {
      await runLiveEvalCommand({
        config: options.config,
        profile: options.profile,
        fixture: options.fixture,
        rounds: options.rounds,
        workdir: options.workdir,
        goal: options.goal
      });
    });

  program.command("real-benchmark")
    .description("Run a retained benchmark suite across multiple real-eval fixtures")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-s, --suite <id>", "Real eval suite id", "daily-workflow-suite")
    .option("-w, --workdir <path>", "Real evaluation output directory", "runs/real-evals")
    .action(async (options: { config: string; profile?: string; suite: string; workdir: string }) => {
      const startedAt = new Date().toISOString();
      const suite = await loadRealEvalSuite(options.suite);
      const evalRoot = resolve(options.workdir, `suite-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await mkdir(evalRoot, { recursive: true });
      await writeFile(resolve(evalRoot, "suite.json"), JSON.stringify(suite, null, 2));

      const fixtureResults = [];
      for (const fixtureSpec of suite.fixtures) {
        const fixture = await loadRealEvalFixture(fixtureSpec.id);
        const result = await runRealEvalFixtureSuite({
          fixture,
          rounds: fixtureSpec.rounds,
          goal: fixtureSpec.goal ?? fixture.goal,
          profileConfigPath: options.config,
          profile: options.profile,
          baseDir: resolve(evalRoot, `fixture-${fixture.id}`)
        });
        fixtureResults.push({
          fixture: fixture.id,
          goal: result.goal,
          modelBindings: result.modelBindings,
          rounds: fixtureSpec.rounds,
          requestedRounds: result.rounds.length,
          passed: result.passed,
          successfulConsecutiveRounds: result.successfulConsecutiveRounds,
          results: result.rounds
        });
      }

      const requiredConsecutiveRounds = fixtureResults.reduce((count, fixtureResult) => count + fixtureResult.rounds, 0);
      const passed = fixtureResults.every((fixtureResult) => fixtureResult.passed);
      const summary = {
        schemaVersion: "real-eval.v1",
        evidenceLevel: "real",
        mode: "suite",
        suiteId: suite.id,
        suiteName: suite.name,
        suiteDescription: suite.description,
        modelBindings: fixtureResults[0]?.modelBindings ?? [],
        passed,
        requiredConsecutiveRounds,
        successfulConsecutiveRounds: countConsecutiveFixtureSuccesses(fixtureResults),
        profile: options.profile ?? null,
        requestedFixtures: suite.fixtures.length,
        requestedRounds: requiredConsecutiveRounds,
        fixtures: fixtureResults,
        scoring: {
          fixtureCount: suite.fixtures.length,
          passedFixtureCount: fixtureResults.filter((fixtureResult) => fixtureResult.passed).length,
          completedFixtureCount: fixtureResults.length
        },
        evalRoot,
        startedAt,
        finishedAt: new Date().toISOString()
      };
      await writeFile(resolve(evalRoot, "summary.json"), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
      if (!passed) {
        process.exitCode = 1;
      }
    });

  program.command("record-baseline")
    .description("Import retained comparative benchmark artifacts for Claude Code or Codex")
    .argument("<provider>", "baseline provider: claude-code or codex")
    .argument("<source>", "Baseline run directory containing summary.json")
    .option("-w, --workdir <path>", "Target repository root", ".")
    .option("-n, --name <name>", "Destination run folder name (defaults to source directory name)")
    .action(async (
      providerArg: string,
      source: string,
      options: { workdir: string; name?: string }
    ) => {
      const workdir = resolve(options.workdir);
      const provider = normalizeProvider(providerArg);
      if (!provider) {
        console.error(`Unsupported baseline provider: ${providerArg}. Use claude-code or codex.`);
        process.exitCode = 1;
        return;
      }

      const sourceDir = resolve(source);
      try {
        const sourceStats = await stat(sourceDir);
        if (!sourceStats.isDirectory()) {
          console.error("record-baseline expects a source directory path containing summary.json");
          process.exitCode = 1;
          return;
        }
      } catch {
        console.error(`record-baseline source does not exist: ${sourceDir}`);
        process.exitCode = 1;
        return;
      }

      const sourceSummary = await findSummaryJson(sourceDir, 12);
      if (!sourceSummary) {
        console.error(`No summary.json found beneath source: ${sourceDir}`);
        process.exitCode = 1;
        return;
      }

      const summaryPayload = await parseComparativeSummary(sourceSummary);
      if (!summaryPayload) {
        console.error(`summary.json at ${sourceSummary} is missing required comparative evidence fields.`);
        process.exitCode = 1;
        return;
      }

      const destinationRoot = resolve(workdir, "runs/comparative-baselines", provider);
      const baseName = options.name ?? basename(sourceDir);
      let destination = resolve(destinationRoot, baseName);
      let counter = 2;
      while (existsSync(destination)) {
        destination = resolve(destinationRoot, `${baseName}-${counter}`);
        counter += 1;
      }

      await mkdir(destinationRoot, { recursive: true });
      await cp(sourceDir, destination, { recursive: true });

      const manifest = {
        importedAt: new Date().toISOString(),
        provider,
        sourceSummary,
        destination,
        summary: summaryPayload
      };
      await writeFile(resolve(destination, "record-baseline.json"), JSON.stringify(manifest, null, 2), "utf8");

      console.log(JSON.stringify({
        action: "record-baseline",
        status: "ok",
        provider,
        destination,
        fixtureCoverage: summaryPayload.fixtures,
        passed: summaryPayload.passed,
        evidenceMode: summaryPayload.mode
      }, null, 2));
    });

  program.command("status")
    .argument("<runId>", "Run id")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string, options: { workdir: string }) => {
      const store = new StateStore(resolve(options.workdir, "runs"));
      const state = await store.loadRun(runId);
      if (!state) {
        throw new Error(`Run not found: ${runId}`);
      }
      console.log(JSON.stringify(state, null, 2));
    });

  program.command("inspect")
    .argument("<runId>", "Run id")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string, options: { workdir: string }) => {
      const store = new StateStore(resolve(options.workdir, "runs"));
      const state = await store.loadRun(runId);
      if (!state) {
        throw new Error(`Run not found: ${runId}`);
      }
      const events = await store.loadEvents(runId);
      console.log(JSON.stringify({ state, events }, null, 2));
    });

  program.command("list")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (options: { workdir: string }) => {
      const store = new StateStore(resolve(options.workdir, "runs"));
      console.log(JSON.stringify(await store.listRuns(), null, 2));
    });

  program.command("bench")
    .description("Aggregate retained metrics across run directories or eval roots")
    .option("-w, --workdir <path>", "Root path to scan for metrics", ".")
    .action(async (options: { workdir: string }) => {
      const root = resolve(options.workdir);
      const metrics = await collectRunMetrics(root);
      console.log(JSON.stringify({
        root,
        summary: summarizeBench(metrics),
        runs: metrics
      }, null, 2));
    });

  program.command("readiness")
    .description("Audit real and fake evidence against the 2027 product-readiness goals")
    .option("-w, --workdir <path>", "Repository root to audit", ".")
    .action(async (options: { workdir: string }) => {
      const report = await buildReadinessReport(resolve(options.workdir));
      console.log(JSON.stringify(report, null, 2));
      if (report.summary.unprovenCount > 0 || report.summary.missingEvidenceCount > 0) {
        process.exitCode = 1;
      }
    });

  program.command("setup")
    .description("Validate configuration, profile, and workspace for first-run onboarding.")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--json", "Output machine-readable report")
    .action(async (options: { config: string; profile?: string; workdir: string; json?: boolean }) => {
      const report = await runSetupCheck({
        configPath: options.config,
        workdir: options.workdir,
        profileName: options.profile
      });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        for (const item of report.errors) {
          console.log(`ERROR [${item.id}] ${item.summary}`);
          console.log(`  ${item.detail}`);
        }
        for (const item of report.warnings) {
          console.log(`WARN [${item.id}] ${item.summary}`);
          console.log(`  ${item.detail}`);
        }
        if (report.recommendations.length > 0) {
          console.log("RECOMMENDATIONS:");
          for (const recommendation of report.recommendations) {
            console.log(`- ${recommendation}`);
          }
        }
        console.log(`Setup status: ${report.passed ? "PASS" : "FAIL"}`);
      }
      if (!report.passed) {
        process.exitCode = 1;
      }
    });

  program.command("review")
    .description("Review local git changes and emit structured findings")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--cached", "Review staged changes instead of unstaged tracked changes")
    .option("--base <rev>", "Review diff from a base revision")
    .option("--head <rev>", "Review diff to a head revision")
    .option("-o, --output-dir <path>", "Directory for review artifacts", "reviews")
    .action(async (options: {
      config: string;
      profile?: string;
      workdir: string;
      cached?: boolean;
      base?: string;
      head?: string;
      outputDir: string;
    }) => {
      const { config } = await runtime(options.config, options.workdir, options.profile);
      const review = await runReview(config, options.workdir, {
        ...(options.cached ? { cached: true } : {}),
        ...(options.base ? { base: options.base } : {}),
        ...(options.head ? { head: options.head } : {}),
        outputDir: options.outputDir
      });
      console.log(JSON.stringify({
        repoRoot: review.input.repoRoot,
        verdict: review.result.verdict,
        summary: review.result.summary,
        findingCount: review.result.findings.length,
        changedFiles: review.input.changedFiles.map((file) => ({
          path: file.path,
          status: file.status
        })),
        artifacts: review.artifacts
      }, null, 2));
      if (review.result.verdict === "issues_found") {
        process.exitCode = 1;
      }
    });

  program.command("tui")
    .description("Open a terminal dashboard for run state and events")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--once", "Render once and exit")
    .action(async (options: { workdir: string; once?: boolean }) => {
      const store = new StateStore(resolve(options.workdir, "runs"));
      await runTui(store, Boolean(options.once));
    });

  return program;
}

async function runtime(configPath: string, workdirPath: string, profile?: string): Promise<{ runner: Runner; store: StateStore; config: Awaited<ReturnType<typeof loadConfigWithOptionalProfile>> }> {
  const configFile = resolve(configPath);
  if (!existsSync(configFile)) {
    throw new Error(`Config file not found: ${configFile}`);
  }
  const config = await loadConfigWithOptionalProfile(configFile, profile);
  const workdir = resolve(workdirPath || config.execution.workingDirectory);
  const store = new StateStore(resolve(workdir, "runs"));
  return { runner: new Runner(config, store, workdir), store, config };
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected positive integer, got ${value}`);
  }
  return parsed;
}

function countLeadingCompleted(results: Array<{ status: string }>): number {
  let count = 0;
  for (const result of results) {
    if (result.status !== "completed") {
      break;
    }
    count += 1;
  }
  return count;
}

function sanitizeCommandOutput(...parts: string[]): string {
  return parts.filter(Boolean).join("\n").trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function normalizeProvider(value: string): "claude-code" | "codex" | null {
  const normalized = value.trim().toLowerCase();
  if (["claude", "claude-code", "claude code"].includes(normalized)) {
    return "claude-code";
  }
  if (["codex"].includes(normalized)) {
    return "codex";
  }
  return null;
}

async function findSummaryJson(root: string, maxDepth: number, currentDepth = 0): Promise<string | null> {
  if (currentDepth > maxDepth) {
    return null;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isFile() && entry.name === "summary.json") {
      return path;
    }
    if (entry.isDirectory()) {
      const nested = await findSummaryJson(path, maxDepth, currentDepth + 1);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

async function parseComparativeSummary(summaryPath: string): Promise<{
  mode: string;
  passed: boolean;
  fixtures: string[];
} | null> {
  const raw = JSON.parse(await readFile(summaryPath, "utf8")) as {
    evidenceType?: unknown;
    fixture?: unknown;
    fixtures?: unknown;
    mode?: unknown;
    schemaVersion?: unknown;
    suiteId?: unknown;
    passed?: unknown;
    scoring?: unknown;
  };

  const evidenceType = raw.evidenceType === "comparative" || raw.evidenceType === "real" || raw.evidenceType === "smoke" || raw.evidenceType === "fake"
    ? raw.evidenceType
    : undefined;
  const passed = raw.passed === true;
  const mode = typeof raw.mode === "string" ? raw.mode : "unknown";

  const fixtures = new Set<string>();
  if (typeof raw.fixture === "string" && raw.fixture.trim().length > 0) {
    fixtures.add(raw.fixture);
  }
  if (Array.isArray(raw.fixtures)) {
    for (const fixtureEntry of raw.fixtures) {
      if (typeof fixtureEntry === "string" && fixtureEntry.trim().length > 0) {
        fixtures.add(fixtureEntry);
        continue;
      }
      if (fixtureEntry && typeof fixtureEntry === "object" && "fixture" in fixtureEntry && typeof fixtureEntry.fixture === "string") {
        if (fixtureEntry.fixture.trim().length > 0) {
          fixtures.add(fixtureEntry.fixture);
        }
      }
    }
  }

  const hasExpectedShape =
    typeof evidenceType === "string" ||
    typeof raw.schemaVersion === "string" ||
    typeof raw.suiteId === "string";
  if (!hasExpectedShape) {
    return null;
  }
  if (!passed && fixtures.size === 0) {
    return {
      mode,
      passed,
      fixtures: []
    };
  }

  return {
    mode,
    passed,
    fixtures: [...fixtures]
  };
}

function countLeadingPassed(results: Array<{ passed: boolean }>): number {
  let count = 0;
  for (const result of results) {
    if (!result.passed) {
      break;
    }
    count += 1;
  }
  return count;
}

async function runRealEvalFixtureSuite(options: {
  fixture: RealEvalFixture;
  rounds: number;
  goal: string;
  profileConfigPath: string;
  profile: string | undefined;
  baseDir: string;
}): Promise<RealEvalResult> {
  const rounds: RealEvalRoundResult[] = [];
  let modelBindings: RealEvalModelBinding[] = [];
  for (let round = 1; round <= options.rounds; round++) {
    const roundDir = resolve(options.baseDir, `round-${String(round).padStart(2, "0")}`);
    const repoDir = resolve(roundDir, "repo");
    await mkdir(roundDir, { recursive: true });
    await copyRealEvalFixture(options.fixture.id, repoDir);
    try {
      const { config } = await runtime(options.profileConfigPath, repoDir, options.profile);
      if (usesFakeAdapter(config)) {
        throw new Error("real-eval refuses fake adapter profiles because they cannot produce product evidence.");
      }
      if (modelBindings.length === 0) {
        modelBindings = snapshotModelBindings(config);
      }

      const fixtureVerificationConfig = {
        ...config,
        verification: {
          ...config.verification,
          localCommands: [...options.fixture.verificationCommands]
        }
      };
      await initializeRealEvalRepository(repoDir, config.execution.timeoutMs);
      const store = new StateStore(resolve(repoDir, "runs"));
      const runner = new Runner(fixtureVerificationConfig, store, repoDir);
      const result = await runner.run(options.goal);
      const runDir = result.runId ? resolve(repoDir, "runs", result.runId) : repoDir;
      const runArtifacts = result.runId ? await store.listArtifacts(result.runId) : [];
      const diffStat = await captureDiffStat(repoDir, config.execution.timeoutMs);
      const assessment = await assessRealEvalFixture(options.fixture, repoDir, config.execution.timeoutMs);
      const passed = result.status === "completed" && assessment.passed;
      rounds.push({
        round,
        status: result.status,
        runId: result.runId,
        runDir,
        runArtifacts,
        repoDir,
        diffStat,
        changedFiles: assessment.changedFiles,
        passed,
        expectedChangedFilesSatisfied: assessment.expectedChangedFilesSatisfied,
        prohibitedArtifactsDetected: assessment.prohibitedArtifactsDetected,
        verificationResults: assessment.verificationResults.map((entry) => ({
          command: entry.command,
          exitCode: entry.exitCode,
          durationMs: entry.durationMs
        })),
        failures: passed ? [] : assessment.failures
      });
      if (!passed) {
        break;
      }
    } catch (error) {
      rounds.push({
        round,
        status: "failed",
        repoDir,
        runDir: repoDir,
        changedFiles: [],
        passed: false,
        expectedChangedFilesSatisfied: false,
        prohibitedArtifactsDetected: [],
        diffStat: "",
        runArtifacts: [],
        verificationResults: [],
        failures: [ (error as Error).message ],
        error: (error as Error).message
      });
      break;
    }
  }

  return {
    goal: options.goal,
    passed: rounds.length === options.rounds && rounds.every((round) => round.passed),
    rounds,
    successfulConsecutiveRounds: countLeadingPassed(rounds),
    modelBindings
  };
}

async function runLiveEvalCommand(options: {
  config: string;
  profile: string | undefined;
  fixture: string;
  rounds: number;
  workdir: string;
  goal: string | undefined;
}) {
  const fixture = await loadRealEvalFixture(options.fixture);
  const evalRoot = resolve(options.workdir, `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(evalRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const results = await runRealEvalFixtureSuite({
    fixture,
    rounds: options.rounds,
    goal: options.goal ?? fixture.goal,
    profileConfigPath: options.config,
    profile: options.profile,
    baseDir: evalRoot
  });
  const passed = results.passed;
  const summary = {
    schemaVersion: "real-eval.v1",
    evidenceLevel: "real",
    passed,
    requiredConsecutiveRounds: options.rounds,
    successfulConsecutiveRounds: results.successfulConsecutiveRounds,
    profile: options.profile ?? null,
    fixture: fixture.id,
    goal: results.goal,
    modelBindings: results.modelBindings,
    evalRoot,
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: "fixture",
    scoring: {
      requestedRounds: options.rounds,
      completedRounds: results.rounds.length,
      passedRounds: results.rounds.filter((round) => round.passed).length
    },
    results: results.rounds
  };
  await writeFile(resolve(evalRoot, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!passed) {
    process.exitCode = 1;
  }
}

async function captureDiffStat(repoDir: string, timeoutMs: number): Promise<string> {
  const diff = await executeCommand("git", ["diff", "--stat"], repoDir, timeoutMs);
  if (diff.exitCode !== 0) {
    return "";
  }
  return diff.stdout.trim();
}

function countConsecutiveFixtureSuccesses(fixtureResults: Array<{ passed: boolean }>): number {
  let count = 0;
  for (const result of fixtureResults) {
    if (!result.passed) {
      break;
    }
    count += 1;
  }
  return count;
}
