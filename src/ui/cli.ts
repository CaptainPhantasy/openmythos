import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import { resolveIssueSource } from "../core/issues.js";
import { collectRunMetrics, summarizeBench } from "../core/metrics.js";
import { resolvePullRequestSource } from "../core/pull-requests.js";
import { runReview } from "../core/reviewer.js";
import { Runner } from "../core/runner.js";
import { StateStore } from "../state/store.js";
import { runTui } from "./tui.js";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("openmythos")
    .description("Deterministic multi-model orchestration harness")
    .version("0.16.0");

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
        passed,
        requiredConsecutiveRounds: options.rounds,
        successfulConsecutiveRounds: countLeadingCompleted(results),
        profile: options.profile,
        evalRoot,
        results
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
