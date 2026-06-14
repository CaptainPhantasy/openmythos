import { Command } from "commander";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { discoverConfigPath, formatConfigDiscoveryFailure } from "../config/discovery.js";
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
import { loadMemory, addNote, searchMemory, clearMemory, addDecision } from "../core/memory.js";
import { scanForSecrets, auditDependencies, assessCommandRisk, summarizeRisk } from "../core/guardrails.js";
import { explainPlan, explainVerification, formatExplanation } from "../core/explanation.js";
import { defaultRoutingPolicies, routeModel, classifyComplexity, classifyRisk } from "../core/model-routing.js";
import { runInit, getProviderPresets } from "../core/init.js";
import { createChatSession, runChatRepl } from "./chat.js";
import { AdapterRegistry } from "../adapters/registry.js";
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
      if (options.tui) {
        const started = await runner.start(goal);
        let settledError: Error | null = null;
        void started.result.catch((error: Error) => {
          settledError = error;
        });

        await runTui(store, {
          watchedRunId: started.runId,
          blockExitWhileActive: true,
          controls: runner
        });

        if (settledError) {
          throw settledError;
        }

        const result = await runner.inspect(started.runId);
        console.log(JSON.stringify(result, null, 2));
        if (result.status !== "completed" && result.status !== "awaiting_approval") {
          process.exitCode = 1;
        }
        return;
      }

      const result = await runner.run(goal);
      console.log(JSON.stringify(result, null, 2));
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

      const fixturesDir = resolve(workdir, "fixtures", "real-eval", "suites");
      let fixtureCount = 0;
      try {
        const suiteEntries = await readdir(fixturesDir);
        for (const entry of suiteEntries) {
          if (entry.endsWith(".json")) {
            const suite = JSON.parse(await readFile(resolve(fixturesDir, entry), "utf8")) as { fixtures?: unknown[] };
            fixtureCount += Array.isArray(suite.fixtures) ? suite.fixtures.length : 0;
          }
        }
      } catch {
        fixtureCount = 0;
      }
      checks.push({
        name: "fixture_coverage",
        passed: fixtureCount >= 3,
        detail: `${fixtureCount} fixtures across suites (minimum 3 required for release)`
      });

      const integrationTestResult = await executeShell("node --test dist/test/integration.test.js", workdir, 60000);
      checks.push({
        name: "integration_tests",
        passed: integrationTestResult.exitCode === 0,
        detail: integrationTestResult.exitCode === 0 ? "4 integration tests pass" : sanitizeCommandOutput(integrationTestResult.stdout, integrationTestResult.stderr).slice(0, 500)
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
      const resolvedConfigPath = discoverConfigPath(options.config, options.workdir).path;
      await mkdir(evalRoot, { recursive: true });
      const results: Array<{ round: number; status: string; runId?: string; workdir: string; error?: string }> = [];

      for (let round = 1; round <= options.rounds; round++) {
        const roundWorkdir = resolve(evalRoot, `round-${String(round).padStart(2, "0")}`);
        await mkdir(roundWorkdir, { recursive: true });
        try {
          const { runner } = await runtime(resolvedConfigPath, roundWorkdir, options.profile);
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
        config: discoverConfigPath(options.config, options.workdir).path,
        profile: options.profile,
        fixture: options.fixture,
        rounds: options.rounds,
        workdir: resolve(options.workdir),
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
        config: discoverConfigPath(options.config, options.workdir).path,
        profile: options.profile,
        fixture: options.fixture,
        rounds: options.rounds,
        workdir: resolve(options.workdir),
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
      const resolvedWorkdir = resolve(options.workdir);
      const profileConfigPath = discoverConfigPath(options.config, resolvedWorkdir).path;
      const evalRoot = resolve(resolvedWorkdir, `suite-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await mkdir(evalRoot, { recursive: true });
      await writeFile(resolve(evalRoot, "suite.json"), JSON.stringify(suite, null, 2));

      const fixtureResults = [];
      for (const fixtureSpec of suite.fixtures) {
        const fixture = await loadRealEvalFixture(fixtureSpec.id);
        const result = await runRealEvalFixtureSuite({
          fixture,
          rounds: fixtureSpec.rounds,
          goal: fixtureSpec.goal ?? fixture.goal,
          profileConfigPath,
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
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--once", "Render once and exit")
    .action(async (options: { config: string; profile?: string; workdir: string; once?: boolean }) => {
      try {
        const { store, runner } = await runtime(options.config, options.workdir, options.profile);
        await runTui(store, {
          once: Boolean(options.once),
          controls: runner
        });
      } catch {
        const store = new StateStore(resolve(options.workdir, "runs"));
        await runTui(store, {
          once: Boolean(options.once)
        });
      }
    });

  program.command("memory")
    .description("View, add, or search durable repository memory")
    .argument("[action]", "list | add | search | clear | decision", "list")
    .argument("[query]", "Search query or note text")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--tags <tags>", "Comma-separated tags for notes")
    .action(async (action: string, query: string | undefined, options: { workdir: string; tags?: string }) => {
      const workdir = resolve(options.workdir);
      if (action === "list") {
        const memory = await loadMemory(workdir);
        console.log(JSON.stringify(memory, null, 2));
      } else if (action === "add" && query) {
        const tags = options.tags ? options.tags.split(",").map((t) => t.trim()) : [];
        const note = await addNote(workdir, query, tags);
        console.log(JSON.stringify({ status: "added", note }, null, 2));
      } else if (action === "search" && query) {
        const results = await searchMemory(workdir, query);
        console.log(JSON.stringify(results, null, 2));
      } else if (action === "decision" && query) {
        const decision = await addDecision(workdir, query, query);
        console.log(JSON.stringify({ status: "added", decision }, null, 2));
      } else if (action === "clear") {
        await clearMemory(workdir);
        console.log(JSON.stringify({ status: "cleared" }, null, 2));
      } else {
        console.error("Usage: memory [list|add|search|clear|decision] [query]");
        process.exitCode = 1;
      }
    });

  program.command("scan")
    .description("Run security, secret, and dependency guardrails on the repository")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("--file <path>", "Scan a specific file for secrets")
    .option("--command <cmd>", "Assess a command for destructive patterns")
    .action(async (options: { workdir: string; file?: string; command?: string }) => {
      const workdir = resolve(options.workdir);
      const findings = [];
      if (options.command) {
        findings.push(...assessCommandRisk(options.command));
      } else if (options.file) {
        const { readFile } = await import("node:fs/promises");
        const content = await readFile(resolve(workdir, options.file), "utf8");
        findings.push(...scanForSecrets(content, options.file));
      } else {
        findings.push(...await auditDependencies(workdir));
      }
      const summary = summarizeRisk(findings);
      console.log(JSON.stringify({ findings, summary }, null, 2));
      if (summary.level === "dangerous") {
        process.exitCode = 1;
      }
    });

  program.command("explain")
    .description("Explain a run's plan, routing decisions, and verification results")
    .argument("[runId]", "Run id to explain")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (runId: string | undefined, options: { config: string; workdir: string }) => {
      const workdir = resolve(options.workdir);
      if (!runId) {
        const policies = defaultRoutingPolicies();
        console.log(formatExplanation({
          summary: "Default model routing policies:",
          details: policies.map((p) => `${p.taskType}: ${p.preferredRole} (max cost: ${p.maxCostCents ?? "unlimited"}c, max latency: ${p.maxLatencyMs ?? "unlimited"}ms)`),
        }));
        return;
      }
      const store = new StateStore(resolve(workdir, "runs"));
      const plan = await store.readArtifact<{ tasks: Array<{ id: string; role: string; description: string; tools: string[]; dependsOn?: string[] }>; successCriteria: string[] }>(runId, "plan.json");
      if (plan) {
        const explanation = explainPlan(plan);
        console.log(formatExplanation(explanation));
      } else {
        console.log("No plan found for run " + runId);
      }
    });

  program.command("onboard")
    .description("First-run onboarding wizard for profiles, keys, and workspace binding")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (options: { workdir: string }) => {
      const workdir = resolve(options.workdir);
      const configPath = discoverConfigPath("openmythos.config.json", workdir).path;
      const report = await runSetupCheck({ workdir, configPath });
      console.log(JSON.stringify({
        step: "setup_check",
        passed: report.passed,
        errors: report.errors,
        warnings: report.warnings,
        recommendations: report.recommendations
      }, null, 2));
      if (!report.passed) {
        console.log("\nOnboarding incomplete. Fix the errors above, then run again.");
        process.exitCode = 1;
      } else {
        console.log("\nOnboarding complete. Try: openmythos run \"your goal\"");
      }
    });

  program.command("init")
    .description("Create an openmythos.config.json from detected API keys or a specified provider")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .option("-p, --provider <id>", "Provider preset: zai, openai, anthropic, gemini")
    .action(async (options: { workdir: string; provider?: string }) => {
      const workdir = resolve(options.workdir);
      try {
        const result = await runInit(workdir, options.provider);
        if (result.alreadyExisted) {
          console.log(`Config already exists at ${result.configPath}`);
          console.log("Delete it first if you want to regenerate.");
          return;
        }
        console.log(`Created ${result.configPath}`);
        console.log(`Provider: ${result.provider}`);
        console.log(`API key env: ${result.apiKeyEnv}`);
        console.log(`API key present: ${result.apiKeyPresent ? "yes" : "NO — set " + result.apiKeyEnv + " in your environment"}`);
        console.log("\nNext steps:");
        console.log("  openmythos run \"your goal\"");
        console.log("  openmythos chat");
        if (!result.apiKeyPresent) {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(`Init failed: ${(error as Error).message}`);
        console.error("\nAvailable providers:");
        for (const preset of getProviderPresets()) {
          console.error(`  ${preset.id}: ${preset.name} (requires ${preset.apiKeyEnv})`);
        }
        process.exitCode = 1;
      }
    });

  program.command("chat")
    .description("Start an interactive coding chat session")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-p, --profile <nameOrPath>", "Config profile overlay")
    .option("-w, --workdir <path>", "Target working directory", ".")
    .action(async (options: { config: string; profile?: string; workdir: string }) => {
      const { config, adapters, workdir: resolvedWorkdir } = await chatRuntime(options.config, options.workdir, options.profile);
      const session = createChatSession(resolvedWorkdir, config, adapters);
      await runChatRepl(session);
    });

  // === FILE OPERATIONS ===
  program.command("read")
    .description("Read and display a file")
    .argument("<path>", "File path to read")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("-l, --lines <n>", "Max lines to show", parsePositiveInt, 500)
    .action(async (filePath: string, options: { workdir: string; lines: number }) => {
      const abs = resolve(options.workdir, filePath);
      const content = await readFile(abs, "utf8");
      const lines = content.split("\n").slice(0, options.lines);
      lines.forEach((line, i) => console.log(`${String(i + 1).padStart(4)}: ${line}`));
    });

  program.command("write")
    .description("Write content to a file (use --stdin for piped input)")
    .argument("<path>", "File path to write")
    .argument("[content]", "Content to write (omit and use --stdin for piped input)")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--stdin", "Read content from stdin")
    .option("--append", "Append to file instead of overwriting")
    .action(async (filePath: string, content: string | undefined, options: { workdir: string; stdin?: boolean; append?: boolean }) => {
      const abs = resolve(options.workdir, filePath);
      let text = content ?? "";
      if (options.stdin) {
        text = await readStdin();
      }
      if (options.append) {
        const existing = existsSync(abs) ? await readFile(abs, "utf8") : "";
        text = existing + text;
      }
      await writeFile(abs, text, "utf8");
      console.log(`Wrote ${text.length} chars to ${filePath}`);
    });

  program.command("edit")
    .description("Find and replace text in a file")
    .argument("<path>", "File path to edit")
    .argument("<find>", "Text to find")
    .argument("<replace>", "Replacement text")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--all", "Replace all occurrences (default: first only)")
    .action(async (filePath: string, find: string, replace: string, options: { workdir: string; all?: boolean }) => {
      const abs = resolve(options.workdir, filePath);
      const content = await readFile(abs, "utf8");
      const flags = options.all ? "g" : "";
      const regex = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      const count = (content.match(regex) || []).length;
      const updated = content.replace(regex, replace);
      await writeFile(abs, updated, "utf8");
      console.log(`Replaced ${count} occurrence(s) in ${filePath}`);
    });

  program.command("search")
    .description("Search file contents (regex supported)")
    .argument("<pattern>", "Search pattern")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("-p, --path <dir>", "Search within this subdirectory")
    .option("-i, --ignore-case", "Case-insensitive search")
    .option("--ext <extensions>", "Comma-separated file extensions to include")
    .action(async (pattern: string, options: { workdir: string; path?: string; ignoreCase?: boolean; ext?: string }) => {
      const searchPath = resolve(options.workdir, options.path ?? ".");
      const results = await searchFiles(pattern, searchPath, options.ignoreCase ?? false, options.ext);
      if (results.length === 0) { console.log("No matches found."); return; }
      for (const result of results) {
        for (const line of result.matches) {
          console.log(`${result.file}:${line.num}: ${line.text}`);
        }
      }
      console.log(`\n${results.length} file(s), ${results.reduce((s, r) => s + r.matches.length, 0)} match(es)`);
    });

  program.command("ls")
    .description("List files in a directory")
    .argument("[path]", "Directory to list", ".")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("-a, --all", "Show hidden files")
    .action(async (dirPath: string, options: { workdir: string; all?: boolean }) => {
      const abs = resolve(options.workdir, dirPath);
      const entries = await readdir(abs);
      const filtered = options.all ? entries : entries.filter((e) => !e.startsWith("."));
      for (const entry of filtered.sort()) {
        const statResult = await stat(resolve(abs, entry));
        const type = statResult.isDirectory() ? "dir " : "file";
        const size = statResult.isFile() ? String(statResult.size).padStart(8) : "       -";
        console.log(`${type} ${size}  ${entry}`);
      }
    });

  // === GIT OPERATIONS ===
  program.command("diff")
    .description("Show git diff")
    .argument("[path]", "Path to diff", ".")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--cached", "Show staged changes")
    .action(async (path: string, options: { workdir: string; cached?: boolean }) => {
      const args = ["diff"];
      if (options.cached) args.push("--cached");
      if (path !== ".") args.push(path);
      const result = await executeCommand("git", args, resolve(options.workdir), 30000);
      console.log(result.stdout || "(no changes)");
    });

  program.command("log")
    .description("Show git log")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("-n, --count <n>", "Number of commits", parsePositiveInt, 20)
    .option("--oneline", "One-line format")
    .action(async (options: { workdir: string; count: number; oneline?: boolean }) => {
      const args = ["log", `-${options.count}`];
      if (options.oneline) args.push("--oneline");
      const result = await executeCommand("git", args, resolve(options.workdir), 15000);
      console.log(result.stdout);
    });

  program.command("gst")
    .description("Show git status (use 'status' for run status)")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--short", "Short format")
    .action(async (options: { workdir: string; short?: boolean }) => {
      const args = ["status"];
      if (options.short) args.push("--short");
      const result = await executeCommand("git", args, resolve(options.workdir), 15000);
      console.log(result.stdout);
    });

  program.command("push")
    .description("Push commits to remote")
    .argument("[remote]", "Remote name", "origin")
    .argument("[branch]", "Branch name")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--force", "Force push")
    .action(async (remote: string, branch: string | undefined, options: { workdir: string; force?: boolean }) => {
      const args = ["push"];
      if (options.force) args.push("--force");
      args.push(remote);
      if (branch) args.push(branch);
      const result = await executeCommand("git", args, resolve(options.workdir), 60000);
      if (result.exitCode !== 0) { console.error(result.stderr); process.exitCode = 1; }
      else console.log(result.stdout || "Pushed.");
    });

  program.command("pull")
    .description("Pull from remote")
    .argument("[remote]", "Remote name", "origin")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--rebase", "Rebase instead of merge")
    .action(async (remote: string, options: { workdir: string; rebase?: boolean }) => {
      const args = ["pull"];
      if (options.rebase) args.push("--rebase");
      args.push(remote);
      const result = await executeCommand("git", args, resolve(options.workdir), 60000);
      if (result.exitCode !== 0) { console.error(result.stderr); process.exitCode = 1; }
      else console.log(result.stdout || "Pulled.");
    });

  program.command("checkout")
    .description("Checkout a branch or create a new one")
    .argument("<branch>", "Branch name")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("-b", "Create a new branch")
    .action(async (branch: string, options: { workdir: string; b?: boolean }) => {
      const args = ["checkout"];
      if (options.b) args.push("-b");
      args.push(branch);
      const result = await executeCommand("git", args, resolve(options.workdir), 15000);
      if (result.exitCode !== 0) { console.error(result.stderr); process.exitCode = 1; }
      else console.log(`Switched to ${branch}`);
    });

  program.command("merge")
    .description("Merge a branch into the current branch")
    .argument("<branch>", "Branch to merge")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--no-ff", "Create a merge commit even if fast-forward")
    .action(async (branch: string, options: { workdir: string; noff?: boolean }) => {
      const args = ["merge"];
      if (options.noff) args.push("--no-ff");
      args.push(branch);
      const result = await executeCommand("git", args, resolve(options.workdir), 30000);
      if (result.exitCode !== 0) { console.error(result.stderr); process.exitCode = 1; }
      else console.log(result.stdout || `Merged ${branch}`);
    });

  // === SHELL & BUILD ===
  program.command("exec")
    .description("Execute a shell command")
    .argument("<command>", "Shell command to execute")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--timeout <ms>", "Timeout in ms", parsePositiveInt, 120000)
    .action(async (command: string, options: { workdir: string; timeout: number }) => {
      const result = await executeShell(command, resolve(options.workdir), options.timeout);
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });

  program.command("test")
    .description("Run project tests (auto-detects framework)")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("-- <args...>", "Pass additional arguments to test runner")
    .allowUnknownOption(true)
    .action(async (options: { workdir: string }) => {
      const workdir = resolve(options.workdir);
      const cmd = await autoDetectCommand(workdir, [
        { check: "package.json", cmd: "npm test" },
        { check: "Cargo.toml", cmd: "cargo test" },
        { check: "go.mod", cmd: "go test ./..." },
        { check: "pyproject.toml", cmd: "pytest" },
        { check: "pytest.ini", cmd: "pytest" },
        { check: "Makefile", cmd: "make test" },
      ]);
      if (!cmd) { console.error("Could not detect test runner. Use: openmythos exec '<test-command>'"); process.exitCode = 1; return; }
      console.log(`Running: ${cmd}`);
      const result = await executeShell(cmd, workdir, 300000);
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });

  program.command("build")
    .description("Run project build (auto-detects)")
    .option("-w, --workdir <path>", "Working directory", ".")
    .action(async (options: { workdir: string }) => {
      const workdir = resolve(options.workdir);
      const cmd = await autoDetectCommand(workdir, [
        { check: "package.json", cmd: "npm run build", jsonCheck: "build" },
        { check: "Cargo.toml", cmd: "cargo build" },
        { check: "go.mod", cmd: "go build ./..." },
        { check: "Makefile", cmd: "make" },
      ]);
      if (!cmd) { console.error("Could not detect build command."); process.exitCode = 1; return; }
      console.log(`Running: ${cmd}`);
      const result = await executeShell(cmd, workdir, 300000);
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });

  program.command("lint")
    .description("Run linter (auto-detects)")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--fix", "Auto-fix issues")
    .action(async (options: { workdir: string; fix?: boolean }) => {
      const workdir = resolve(options.workdir);
      let cmd: string | null = null;
      if (existsSync(resolve(workdir, "package.json"))) {
        const pkg = JSON.parse(await readFile(resolve(workdir, "package.json"), "utf8"));
        if (pkg.scripts?.lint) cmd = options.fix ? "npm run lint -- --fix" : "npm run lint";
        else if (existsSync(resolve(workdir, ".eslintrc.js")) || existsSync(resolve(workdir, ".eslintrc.json")) || existsSync(resolve(workdir, "eslint.config.js"))) {
          cmd = options.fix ? "npx eslint . --fix" : "npx eslint .";
        }
      } else if (existsSync(resolve(workdir, "Cargo.toml"))) cmd = "cargo clippy";
      else if (existsSync(resolve(workdir, "go.mod"))) cmd = "go vet ./...";
      if (!cmd) { console.error("Could not detect linter."); process.exitCode = 1; return; }
      console.log(`Running: ${cmd}`);
      const result = await executeShell(cmd, workdir, 120000);
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });

  // === META COMMANDS ===
  program.command("config")
    .description("Show current configuration")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("-p, --profile <name>", "Profile name")
    .action(async (options: { config: string; workdir: string; profile?: string }) => {
      const configResolution = discoverConfigPath(options.config, resolve(options.workdir));
      const config = await loadConfigWithOptionalProfile(configResolution.path, options.profile);
      console.log(JSON.stringify(config, null, 2));
    });

  program.command("doctor")
    .description("Diagnose environment health and configuration")
    .option("-c, --config <path>", "Config file", "openmythos.config.json")
    .option("-w, --workdir <path>", "Working directory", ".")
    .action(async (options: { config: string; workdir: string }) => {
      const workdir = resolve(options.workdir);
      const configResolution = discoverConfigPath(options.config, workdir);
      console.log("=== OpenMythos Doctor ===\n");
      console.log(`Working directory: ${workdir}`);
      console.log(`Config path: ${configResolution.path}`);
      console.log(`Config found: ${existsSync(configResolution.path) ? "YES" : "NO"}`);
      const gitResult = await executeCommand("git", ["rev-parse", "--is-inside-work-tree"], workdir, 5000);
      console.log(`Git repo: ${gitResult.exitCode === 0 ? "YES" : "NO"}`);
      const nodeResult = await executeCommand("node", ["--version"], workdir, 5000);
      console.log(`Node: ${nodeResult.stdout.trim() || "not found"}`);
      const presets = getProviderPresets();
      for (const preset of presets) {
        const has = !!process.env[preset.apiKeyEnv];
        console.log(`${has ? "✓" : "✗"} ${preset.name}: ${preset.apiKeyEnv} ${has ? "set" : "not set"}`);
      }
      if (existsSync(configResolution.path)) {
        const report = await runSetupCheck({ workdir, configPath: configResolution.path });
        console.log(`\nSetup check: ${report.passed ? "PASS" : "FAIL"}`);
        for (const err of report.errors) console.log(`  ERROR: ${err.summary}`);
        for (const warn of report.warnings) console.log(`  WARN:  ${warn.summary}`);
      }
    });

  program.command("history")
    .description("Show recent runs")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("-n, --count <n>", "Number of runs", parsePositiveInt, 10)
    .action(async (options: { workdir: string; count: number }) => {
      const runsDir = resolve(options.workdir, "runs");
      if (!existsSync(runsDir)) { console.log("No runs found."); return; }
      const entries = await readdir(runsDir);
      const recent = entries.sort().reverse().slice(0, options.count);
      for (const entry of recent) {
        const statePath = resolve(runsDir, entry, "state.json");
        if (!existsSync(statePath)) continue;
        try {
          const state = JSON.parse(await readFile(statePath, "utf8"));
          console.log(`${state.status?.padEnd(20)} ${entry}`);
        } catch { /* skip */ }
      }
    });

  program.command("clean")
    .description("Clean up run artifacts")
    .option("-w, --workdir <path>", "Working directory", ".")
    .option("--all", "Remove all runs (default: keep last 10)")
    .option("--dry-run", "Show what would be deleted without deleting")
    .action(async (options: { workdir: string; all?: boolean; dryRun?: boolean }) => {
      const runsDir = resolve(options.workdir, "runs");
      if (!existsSync(runsDir)) { console.log("Nothing to clean."); return; }
      const entries = (await readdir(runsDir)).sort();
      const toDelete = options.all ? entries : entries.slice(0, Math.max(0, entries.length - 10));
      if (toDelete.length === 0) { console.log("Nothing to clean."); return; }
      for (const entry of toDelete) {
        const fullPath = resolve(runsDir, entry);
        if (options.dryRun) { console.log(`WOULD DELETE: ${entry}`); }
        else { await rm(fullPath, { recursive: true, force: true }); console.log(`Deleted: ${entry}`); }
      }
      console.log(`${options.dryRun ? "Would delete" : "Deleted"} ${toDelete.length} run(s).`);
    });

  return program;
}

async function chatRuntime(configPath: string, workdirPath: string, profile?: string): Promise<{ config: Awaited<ReturnType<typeof loadConfigWithOptionalProfile>>; adapters: AdapterRegistry; workdir: string }> {
  const resolvedWorkdir = resolve(workdirPath);
  const configResolution = discoverConfigPath(configPath, resolvedWorkdir);
  const configFile = configResolution.path;
  if (!existsSync(configFile)) {
    throw new Error(formatConfigDiscoveryFailure(configResolution));
  }
  const config = await loadConfigWithOptionalProfile(configFile, profile);
  const adapters = new AdapterRegistry(config);
  return { config, adapters, workdir: resolvedWorkdir };
}

async function runtime(configPath: string, workdirPath: string, profile?: string): Promise<{ runner: Runner; store: StateStore; config: Awaited<ReturnType<typeof loadConfigWithOptionalProfile>> }> {
  const resolvedWorkdir = resolve(workdirPath);
  const configResolution = discoverConfigPath(configPath, resolvedWorkdir);
  const configFile = configResolution.path;
  if (!existsSync(configFile)) {
    throw new Error(formatConfigDiscoveryFailure(configResolution));
  }
  const config = await loadConfigWithOptionalProfile(configFile, profile);
  const workdir = resolve(resolvedWorkdir || config.execution.workingDirectory);
  const store = new StateStore(resolve(workdir, "runs"));
  return { runner: new Runner(config, store, workdir), store, config };
}

async function readStdin(): Promise<string> {
  return new Promise((resolveStdin) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolveStdin(data));
    process.stdin.on("error", () => resolveStdin(data));
  });
}

async function searchFiles(pattern: string, searchPath: string, ignoreCase: boolean, extFilter?: string): Promise<Array<{ file: string; matches: Array<{ num: number; text: string }> }>> {
  const flags = ignoreCase ? "gi" : "g";
  const regex = new RegExp(pattern, flags);
  const extensions = extFilter ? extFilter.split(",").map((e) => e.trim().replace(/^\./, "")) : null;
  const results: Array<{ file: string; matches: Array<{ num: number; text: string }> }> = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".openmythos"]);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8 || results.length > 50) return;
    let entries: string[];
    try { entries = await readdir(dir); } catch { return; }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const fullPath = resolve(dir, entry);
      let entryStat;
      try { entryStat = await stat(fullPath); } catch { continue; }
      if (entryStat.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entryStat.isFile()) {
        if (extensions) {
          const ext = entry.split(".").pop() ?? "";
          if (!extensions.includes(ext)) continue;
        }
        try {
          const content = await readFile(fullPath, "utf8");
          if (content.length > 500000) continue;
          const lines = content.split("\n");
          const fileMatches: Array<{ num: number; text: string }> = [];
          for (let i = 0; i < lines.length && fileMatches.length < 20; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i] ?? "")) {
              fileMatches.push({ num: i + 1, text: (lines[i] ?? "").trim().slice(0, 200) });
            }
          }
          if (fileMatches.length > 0) {
            results.push({ file: fullPath, matches: fileMatches });
          }
        } catch { /* skip binary/unreadable */ }
      }
    }
  }

  await walk(searchPath, 0);
  return results;
}

async function autoDetectCommand(workdir: string, candidates: Array<{ check: string; cmd: string; jsonCheck?: string }>): Promise<string | null> {
  for (const candidate of candidates) {
    const checkPath = resolve(workdir, candidate.check);
    if (!existsSync(checkPath)) continue;
    if (candidate.jsonCheck) {
      try {
        const pkg = JSON.parse(await readFile(checkPath, "utf8"));
        if (!pkg.scripts || !pkg.scripts[candidate.jsonCheck]) continue;
      } catch { continue; }
    }
    return candidate.cmd;
  }
  return null;
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
  }
  for (const entry of entries) {
    const path = resolve(root, entry.name);
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
    await copyRealEvalFixture(options.fixture.id, repoDir, options.profileConfigPath);
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
  const resolvedProfileConfigPath = discoverConfigPath(options.config, options.workdir).path;
  const evalRoot = resolve(options.workdir, `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(evalRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const results = await runRealEvalFixtureSuite({
    fixture,
    rounds: options.rounds,
    goal: options.goal ?? fixture.goal,
    profileConfigPath: resolvedProfileConfigPath,
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
