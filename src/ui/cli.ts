import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import { executeCommand } from "../tools/shell.js";
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
