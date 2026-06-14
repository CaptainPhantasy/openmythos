import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

export type EvidenceLevel = "real" | "fake" | "missing";
export type ProductGoalStatus = "supported" | "partial" | "unproven";

export interface EvidenceItem {
  id: string;
  level: EvidenceLevel;
  summary: string;
  artifacts: string[];
  nextActions: string[];
}

export interface ProductGoalAssessment {
  id: string;
  title: string;
  status: ProductGoalStatus;
  realEvidence: EvidenceItem[];
  fakeEvidence: EvidenceItem[];
  missingEvidence: EvidenceItem[];
}

export interface FakeSurfaceReport {
  fakeAdapter: string | null;
  fakeProfile: string | null;
  fakeRunTest: string | null;
  fakeDefaultEval: boolean;
  fakeEvalSummaries: string[];
}

export interface LiveEvalSummary {
  path: string;
  profile: string;
  passed: boolean;
  requiredConsecutiveRounds: number;
  successfulConsecutiveRounds: number;
}

export interface ReadinessReport {
  generatedAt: string;
  repoRoot: string;
  roadmapPath: string;
  fakeSurface: FakeSurfaceReport;
  liveEvalSummaries: LiveEvalSummary[];
  productGoals: ProductGoalAssessment[];
  summary: {
    goalCount: number;
    supportedCount: number;
    partialCount: number;
    unprovenCount: number;
    fakeEvidenceCount: number;
    realEvidenceCount: number;
    missingEvidenceCount: number;
  };
}

export async function buildReadinessReport(repoRoot: string): Promise<ReadinessReport> {
  const root = resolve(repoRoot);
  const roadmapPath = resolve(root, "docs/plans/2026-06-14-openmythos-2027-default-harness-roadmap.md");
  const fakeSurface = await detectFakeSurface(root);
  const liveEvalSummaries = await collectLiveEvalSummaries(root);
  const productGoals = await assessProductGoals(root, liveEvalSummaries);
  const allEvidence = productGoals.flatMap((goal) => [
    ...goal.realEvidence,
    ...goal.fakeEvidence,
    ...goal.missingEvidence
  ]);

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    roadmapPath,
    fakeSurface,
    liveEvalSummaries,
    productGoals,
    summary: {
      goalCount: productGoals.length,
      supportedCount: productGoals.filter((goal) => goal.status === "supported").length,
      partialCount: productGoals.filter((goal) => goal.status === "partial").length,
      unprovenCount: productGoals.filter((goal) => goal.status === "unproven").length,
      fakeEvidenceCount: allEvidence.filter((item) => item.level === "fake").length,
      realEvidenceCount: allEvidence.filter((item) => item.level === "real").length,
      missingEvidenceCount: allEvidence.filter((item) => item.level === "missing").length
    }
  };
}

async function detectFakeSurface(repoRoot: string): Promise<FakeSurfaceReport> {
  const cliPath = resolve(repoRoot, "src/ui/cli.ts");
  return {
    fakeAdapter: existingRelative(repoRoot, "src/adapters/fake.ts"),
    fakeProfile: existingRelative(repoRoot, "profiles/fake.json"),
    fakeRunTest: existingRelative(repoRoot, "src/test/fake-run.test.ts"),
    fakeDefaultEval: await fileContains(cliPath, '.option("-p, --profile <nameOrPath>", "Config profile overlay", "fake")'),
    fakeEvalSummaries: (await collectEvalSummaries(repoRoot))
      .filter((summary) => summary.profile === "fake")
      .map((summary) => summary.path)
  };
}

async function assessProductGoals(repoRoot: string, liveEvalSummaries: LiveEvalSummary[]): Promise<ProductGoalAssessment[]> {
  const types = await readOptional(resolve(repoRoot, "src/core/types.ts"));
  const commandEvidence = evidence("cli.commands", "real", "CLI exposes run, issue, PR, review, bench, eval, and TUI commands.", ["src/ui/cli.ts"], []);
  const tuiInspectionEvidence = evidence("tui.inspect", "real", "TUI renders run lists, metrics, artifacts, and recent events.", ["src/ui/tui.ts"], []);
  const missingTuiControls = evidence("tui.controls.missing", "missing", "TUI does not expose approval, reject, cancel, queue, or replay actions.", ["src/ui/tui.ts"], ["Add execution-native TUI controls for approval, cancellation, queueing, retry, and replay."]);

  const taskTools = extractToolUnion(types);
  const missingTaskTools = ["shell.run", "package.install", "git.branch", "git.stage", "git.commit", "browser.verify", "api.request", "database.query"]
    .filter((tool) => !taskTools.includes(tool));

  const liveGate = strongestLiveGate(liveEvalSummaries);
  const liveGateEvidence = liveGate
    ? evidence(
      "live.zai.marker_gate",
      "real",
      `Live ${liveGate.profile} eval passed ${liveGate.successfulConsecutiveRounds}/${liveGate.requiredConsecutiveRounds} consecutive marker-file rounds.`,
      [liveGate.path],
      ["Treat this as a narrow adapter/harness gate, not full product proof."]
    )
    : evidence("live.zai.marker_gate.missing", "missing", "No passed live non-fake eval summary was found under runs/live-evals.", ["runs/live-evals"], ["Run a retained live eval with a non-fake profile."]);

  return [
    goal(
      "daily-work-surface",
      "OpenMythos Is A Complete Daily Work Surface",
      [
        commandEvidence,
        tuiInspectionEvidence
      ],
      [],
      [
        missingTuiControls,
        evidence("session.loop.missing", "missing", "No interactive session command exists for daily repo work.", ["src/ui/cli.ts"], ["Add a daily-driver session entrypoint that can control active work, not only launch runs."])
      ]
    ),
    goal(
      "execution-fabric",
      "OpenMythos Has A Complete Execution Fabric",
      [
        evidence("bounded.tool.loop", "real", "Model task loop supports bounded tool requests and retained task-tool-turn artifacts.", ["src/core/phases.ts", "src/core/types.ts"], []),
        evidence("dependency.batching", "real", "Execution batches dependency-free tasks and scopes downstream handoff context.", ["src/core/phases.ts"], [])
      ],
      [],
      [
        evidence("task.tools.missing", "missing", `Worker-requestable task tools are incomplete. Missing: ${missingTaskTools.join(", ")}.`, ["src/core/types.ts"], ["Expand TaskToolRequest and execution dispatch for shell, package, git write, browser, API, and database actions."])
      ]
    ),
    goal(
      "verification-safety",
      "OpenMythos Is A Complete Verification And Safety System",
      [
        evidence("governance.review", "real", "Governance preflight, risk review, approval stops, and task verification receipts exist.", ["src/core/governance.ts", "src/core/review.ts", "src/core/phases.ts"], []),
        evidence("local.verification", "real", "Local and task-level verification commands gate runs before model QA.", ["src/core/phases.ts"], [])
      ],
      [],
      [
        evidence("verification.presets.missing", "missing", "No first-class verification presets for lint/build/test/browser/API/security/performance task classes exist.", ["src/core/phases.ts", "openmythos.config.json"], ["Add policy-backed verification presets by task class and risk."])
      ]
    ),
    goal(
      "repo-workflow",
      "OpenMythos Owns The Full Repo Workflow",
      [
        evidence("issue.pr.review", "real", "Issue ingestion, PR ingestion, PR check summaries, and local review workflow exist.", ["src/core/issues.ts", "src/core/pull-requests.ts", "src/core/reviewer.ts"], [])
      ],
      [],
      [
        evidence("git.write.workflow.missing", "missing", "No branch creation, staging, commit preparation, rollback, or PR publication workflow exists.", ["src/ui/cli.ts", "src/core"], ["Add repo lifecycle commands and harness tool actions for branch, stage, commit, rollback, and PR review publication."])
      ]
    ),
    goal(
      "comfortable-adoption",
      "OpenMythos Is Comfortable To Adopt",
      [
        evidence("readme.usage", "real", "README documents installation, profiles, usage, review, issue, PR, TUI, and benchmark commands.", ["README.md"], [])
      ],
      [],
      [
        evidence("onboarding.missing", "missing", "No first-run onboarding, setup validation, or recommended-defaults command exists.", ["README.md", "src/ui/cli.ts"], ["Add setup/onboarding validation for keys, profiles, shell invocation, and workspace binding."])
      ]
    ),
    goal(
      "outcome-superiority",
      "OpenMythos Proves Better Outcomes Than Baseline Harnesses",
      liveGate ? [liveGateEvidence] : [],
      [
        evidence("fake.regressions", "fake", "Fake adapter, fake profile, and fake-run tests cover harness invariants only.", ["src/adapters/fake.ts", "profiles/fake.json", "src/test/fake-run.test.ts"], ["Keep fake coverage as regression-only evidence."])
      ],
      [
        evidence("comparative.baselines.missing", "missing", "No real-task benchmark suite with direct Claude Code and Codex baselines exists.", ["docs/plans/2026-06-14-openmythos-2027-default-harness-roadmap.md"], ["Add real repository benchmark tasks and retained baseline results for direct Claude Code and Codex runs."]),
        liveGate ? evidence("live.gate.scope", "missing", "The retained live gate is a narrow marker-file adapter test, not proof of better daily coding outcomes.", [liveGate.path], ["Replace marker-only claims with real repo task benchmarks."]) : liveGateEvidence
      ]
    )
  ].map(scoreGoal);
}

function goal(
  id: string,
  title: string,
  realEvidence: EvidenceItem[],
  fakeEvidence: EvidenceItem[],
  missingEvidence: EvidenceItem[]
): ProductGoalAssessment {
  return { id, title, status: "unproven", realEvidence, fakeEvidence, missingEvidence };
}

function scoreGoal(goal: ProductGoalAssessment): ProductGoalAssessment {
  const status: ProductGoalStatus = goal.missingEvidence.length === 0
    ? "supported"
    : goal.realEvidence.length > 0
      ? "partial"
      : "unproven";
  return { ...goal, status };
}

function evidence(
  id: string,
  level: EvidenceLevel,
  summary: string,
  artifacts: string[],
  nextActions: string[]
): EvidenceItem {
  return { id, level, summary, artifacts, nextActions };
}

async function collectLiveEvalSummaries(repoRoot: string): Promise<LiveEvalSummary[]> {
  return (await collectEvalSummaries(repoRoot))
    .filter((summary) => summary.profile !== "fake")
    .sort((a, b) => b.successfulConsecutiveRounds - a.successfulConsecutiveRounds);
}

async function collectEvalSummaries(repoRoot: string): Promise<LiveEvalSummary[]> {
  const summaries = await findFiles(resolve(repoRoot, "runs"), "summary.json", 8);
  const parsed: LiveEvalSummary[] = [];
  for (const summaryPath of summaries) {
    try {
      const raw = JSON.parse(await readFile(summaryPath, "utf8")) as {
        profile?: unknown;
        passed?: unknown;
        requiredConsecutiveRounds?: unknown;
        successfulConsecutiveRounds?: unknown;
      };
      parsed.push({
        path: relative(repoRoot, summaryPath),
        profile: typeof raw.profile === "string" ? raw.profile : "unknown",
        passed: raw.passed === true,
        requiredConsecutiveRounds: typeof raw.requiredConsecutiveRounds === "number" ? raw.requiredConsecutiveRounds : 0,
        successfulConsecutiveRounds: typeof raw.successfulConsecutiveRounds === "number" ? raw.successfulConsecutiveRounds : 0
      });
    } catch {
      continue;
    }
  }
  return parsed;
}

function strongestLiveGate(summaries: LiveEvalSummary[]): LiveEvalSummary | null {
  return summaries
    .filter((summary) => summary.passed)
    .sort((a, b) => b.successfulConsecutiveRounds - a.successfulConsecutiveRounds)[0] ?? null;
}

async function findFiles(root: string, targetName: string, maxDepth: number, depth = 0): Promise<string[]> {
  if (depth > maxDepth || !existsSync(root)) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isFile() && basename(path) === targetName) {
      results.push(path);
    }
    if (entry.isDirectory()) {
      results.push(...await findFiles(path, targetName, maxDepth, depth + 1));
    }
  }
  return results;
}

function extractToolUnion(typesSource: string): string[] {
  const match = typesSource.match(/tool:\s*([^;]+);/);
  if (!match?.[1]) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).filter((item): item is string => Boolean(item));
}

async function fileContains(path: string, needle: string): Promise<boolean> {
  return (await readOptional(path)).includes(needle);
}

async function readOptional(path: string): Promise<string> {
  if (!existsSync(path)) {
    return "";
  }
  return readFile(path, "utf8");
}

function existingRelative(repoRoot: string, path: string): string | null {
  const resolved = resolve(repoRoot, path);
  return existsSync(resolved) ? path : null;
}
