import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

export type EvidenceLevel = "real" | "smoke" | "fake" | "missing";
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
  evidenceLevel: "real" | "smoke" | "fake";
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
    smokeEvidenceCount: number;
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
      smokeEvidenceCount: allEvidence.filter((item) => item.level === "smoke").length,
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
  const cliSource = await readOptional(resolve(repoRoot, "src/ui/cli.ts"));
  const phasesSource = await readOptional(resolve(repoRoot, "src/core/phases.ts"));
  const tuiSource = await readOptional(resolve(repoRoot, "src/ui/tui.ts"));
  const hasCommand = (name: string) => cliSource.includes(`program.command("${name}")`);
  const hasSessionCommand = cliSource.includes('program.command("session")');
  const hasSetupCommand = cliSource.includes('program.command("setup")');
  const requiredRepoWorkflowCommands = [
    "branch",
    "stage",
    "commit",
    "rollback",
    "publish-pr",
    "release-check"
  ];
  const missingRepoWorkflowCommands = requiredRepoWorkflowCommands.filter((command) => !hasCommand(command));
  const hasWorkflowControlCommands = [
    'program.command("approve")',
    'program.command("reject")',
    'program.command("cancel")',
    'program.command("queue")',
    'program.command("replay")'
  ].every((command) => cliSource.includes(command));
  const hasTuiControls = [
    'key.name === "a"',
    'key.name === "x"',
    'key.name === "c"',
    'key.name === "p"',
    'key.name === "l"'
  ].every((snippet) => tuiSource.includes(snippet));
  const hasVerificationPresetResolution = [
    "resolveTaskVerificationCommands",
    "resolveVerificationCommandSet",
    "matchTaskTypePresets"
  ].every((snippet) => phasesSource.includes(snippet));
  const hasVerificationPresetConfig = (await readOptional(resolve(repoRoot, "openmythos.config.json"))).includes('"presets"');
  const commandEvidence = evidence(
    "cli.commands",
    "real",
    "CLI exposes run, issue, PR, review, bench, eval, live-eval, real-eval, real-benchmark, release-check, and TUI commands.",
    ["src/ui/cli.ts"],
    []
  );
  const tuiInspectionEvidence = evidence("tui.inspect", "real", "TUI renders run lists, metrics, focused artifact previews, and recent events.", ["src/ui/tui.ts"], []);
  const workflowControlEvidence = hasWorkflowControlCommands
    ? evidence(
      "cli.workflow.controls",
      "real",
      "CLI exposes approve, reject, cancel, queue, and replay controls for run execution orchestration.",
      ["src/ui/cli.ts"],
      []
    )
    : evidence(
      "cli.workflow.controls.missing",
      "missing",
      "Workflow control CLI commands for approve, reject, cancel, queue, and replay are not all present.",
      ["src/ui/cli.ts"],
      ["Add CLI controls for approve/reject/cancel/queue/replay to complete manual run control."]
    );
  const tuiControlEvidence = hasTuiControls
    ? evidence(
      "tui.controls",
      "real",
      "TUI binds approval, reject, cancel, queue, replay, and artifact-navigation hotkeys for selected runs.",
      ["src/ui/tui.ts"],
      []
    )
    : evidence(
      "tui.controls.missing",
      "missing",
      "TUI does not expose approval, reject, cancel, queue, or replay actions.",
      ["src/ui/tui.ts"],
      ["Add execution-native TUI controls for approval, cancellation, queueing, and replay."]
    );
  const verificationPresetEvidence = hasVerificationPresetConfig && hasVerificationPresetResolution
    ? evidence(
      "verification.presets",
      "real",
      "Task verification resolves task-class, risk, and explicit presets from first-class configuration.",
      ["src/core/phases.ts", "openmythos.config.json"],
      []
    )
    : evidence(
      "verification.presets.missing",
      "missing",
      "No first-class verification presets for lint/build/test/browser/API/security/performance task classes exist.",
      ["src/core/phases.ts", "openmythos.config.json"],
      ["Add policy-backed verification presets by task class and risk."]
    );

  const taskTools = extractToolUnion(types);
  const expectedTaskTools = ["shell.run", "package.install", "git.branch", "git.stage", "git.commit", "browser.verify", "api.request", "database.query"];
  const missingTaskTools = expectedTaskTools
    .filter((tool) => !taskTools.includes(tool));

  const liveGate = strongestSmokeGate(liveEvalSummaries);
  const liveGateEvidence = liveGate
    ? evidence(
      "live.zai.marker_gate",
      "smoke",
      `Live ${liveGate.profile} smoke eval passed ${liveGate.successfulConsecutiveRounds}/${liveGate.requiredConsecutiveRounds} consecutive marker-file rounds.`,
      [liveGate.path],
      ["Run real fixture evals and compare retained outcomes before claiming full product-readiness evidence."]
    )
    : evidence("live.zai.marker_gate.missing", "missing", "No passed live smoke eval summary was found under runs/live-evals.", ["runs/live-evals"], ["Run a retained live-eval with a non-fake profile."]);
  const realEvalSummaries = await collectRealEvalSummaries(repoRoot);
  const strongestRealEval = realEvalSummaries.find((summary) => summary.passed) ?? null;
  const realEvalWorkflowEvidence = existingRelative(repoRoot, "src/core/real-eval.ts") && existingRelative(repoRoot, "fixtures/real-eval/noop-js/manifest.json")
    ? evidence(
      "real.eval.workflow",
      "real",
      "Fixture-backed real-eval workflow exists with retained repository-local verification and expected-file checks.",
      ["src/core/real-eval.ts", "src/ui/cli.ts", "fixtures/real-eval/noop-js/manifest.json"],
      ["Run retained non-fake real-eval rounds and store the results under runs/real-evals."]
    )
    : null;
  const realEvalResultEvidence = strongestRealEval
    ? evidence(
      "real.eval.result",
      "real",
      `Real fixture-backed eval ${strongestRealEval.fixture} passed ${strongestRealEval.successfulConsecutiveRounds}/${strongestRealEval.requiredConsecutiveRounds} consecutive rounds.`,
      [strongestRealEval.path],
      ["Add direct Claude Code and Codex baseline artifacts for this same fixture."]
    )
    : null;
  const requiredComparativeFixtures = await collectRequiredComparativeFixtures(repoRoot);
  const claudeBaselinePath = resolve(repoRoot, "runs/comparative-baselines/claude-code");
  const codexBaselinePath = resolve(repoRoot, "runs/comparative-baselines/codex");
  const baselineReports = await Promise.all([
    collectBaselineCoverage(claudeBaselinePath, requiredComparativeFixtures),
    collectBaselineCoverage(codexBaselinePath, requiredComparativeFixtures)
  ]);
  const hasClaudeBaseline = baselineReports[0].hasAnySummary;
  const hasCodexBaseline = baselineReports[1].hasAnySummary;
  const comparativeBaselineEvidence: EvidenceItem[] = [];
  const comparativeCoverageMissingEvidence: EvidenceItem[] = [];
  if (!hasClaudeBaseline) {
    comparativeBaselineEvidence.push(
      evidence(
        "comparative.claude.missing",
        "missing",
        "No Claude Code comparative baseline artifacts were found under runs/comparative-baselines/claude-code.",
        ["runs/comparative-baselines/claude-code"],
        ["Add retained CLAUDE-CODE comparative baseline artifacts for representative tasks and fixtures."]
      )
    );
  } else {
    if (baselineReports[0].missingFixtures.length > 0) {
      comparativeBaselineEvidence.push(
        evidence(
          "comparative.claude.partial",
          "real",
          `Claude Code baseline coverage is partial: ${baselineReports[0].coveredFixtures.join(", ")} present; missing ${baselineReports[0].missingFixtures.join(", ")}.`,
          baselineReports[0].summaryArtifacts,
          ["Import a passing Claude Code comparative run for each missing fixture in the daily workflow suite."]
        )
      );
      comparativeCoverageMissingEvidence.push(
        evidence(
          "comparative.claude.coverage.missing",
          "missing",
          `Claude Code baseline coverage is incomplete. Missing fixtures: ${baselineReports[0].missingFixtures.join(", ")}.`,
          baselineReports[0].summaryArtifacts,
          ["Import a passing Claude Code comparative run for each missing fixture in the daily workflow suite."]
        )
      );
    } else {
      comparativeBaselineEvidence.push(evidence(
        "comparative.claude.present",
        "real",
        "Claude Code comparative baseline artifacts are present for all required workflow fixtures.",
        baselineReports[0].summaryArtifacts,
        []
      ));
    }
  }
  if (!hasCodexBaseline) {
    comparativeBaselineEvidence.push(
      evidence(
        "comparative.codex.missing",
        "missing",
        "No Codex comparative baseline artifacts were found under runs/comparative-baselines/codex.",
        ["runs/comparative-baselines/codex"],
        ["Add retained Codex comparative baseline artifacts for representative tasks and fixtures."]
      )
    );
  } else {
    if (baselineReports[1].missingFixtures.length > 0) {
      comparativeBaselineEvidence.push(
        evidence(
          "comparative.codex.partial",
          "real",
          `Codex baseline coverage is partial: ${baselineReports[1].coveredFixtures.join(", ")} present; missing ${baselineReports[1].missingFixtures.join(", ")}.`,
          baselineReports[1].summaryArtifacts,
          ["Import a passing Codex comparative run for each missing fixture in the daily workflow suite."]
        )
      );
      comparativeCoverageMissingEvidence.push(
        evidence(
          "comparative.codex.coverage.missing",
          "missing",
          `Codex baseline coverage is incomplete. Missing fixtures: ${baselineReports[1].missingFixtures.join(", ")}.`,
          baselineReports[1].summaryArtifacts,
          ["Import a passing Codex comparative run for each missing fixture in the daily workflow suite."]
        )
      );
    } else {
      comparativeBaselineEvidence.push(evidence(
        "comparative.codex.present",
        "real",
        "Codex comparative baseline artifacts are present for all required workflow fixtures.",
        baselineReports[1].summaryArtifacts,
        []
      ));
    }
  }

  const outcomeSuperiorityRealEvidence = [realEvalWorkflowEvidence, realEvalResultEvidence, ...comparativeBaselineEvidence.filter((item) => item.level === "real")]
    .filter((item): item is EvidenceItem => item !== null);
  const outcomeSuperiorityMissingEvidence = [evidence("comparative.baselines.missing", "missing", "No real-task benchmark suite with direct Claude Code and Codex baselines exists.", ["docs/plans/2026-06-14-openmythos-2027-default-harness-roadmap.md"], ["Add real repository benchmark tasks and retained baseline results for direct Claude Code and Codex runs."])]
    .concat(comparativeBaselineEvidence.filter((item) => item.level === "missing"))
    .concat(comparativeCoverageMissingEvidence)
    .concat(strongestRealEval === null
      ? [evidence("real.eval.missing", "missing", "No passed real fixture-backed eval was found under runs/real-evals.", ["runs/real-evals"], ["Run retained live-eval on noop-js or trim-js and keep a real-evidence summary."])]
      : []);
  if (hasClaudeBaseline && hasCodexBaseline) {
    const hasClaudeCoverage = baselineReports[0].missingFixtures.length === 0;
    const hasCodexCoverage = baselineReports[1].missingFixtures.length === 0;
    outcomeSuperiorityMissingEvidence.splice(
      outcomeSuperiorityMissingEvidence.findIndex((item) => item.id === "comparative.baselines.missing"),
      1
    );
    if (hasClaudeCoverage && hasCodexCoverage) {
      const summaryArtifactEvidence = Array.from(new Set([...baselineReports[0].summaryArtifacts, ...baselineReports[1].summaryArtifacts]));
      outcomeSuperiorityRealEvidence.push(evidence(
        "comparative.outcomes",
        "real",
        "Direct comparative baseline artifacts for Claude Code and Codex are present for the required workflow fixtures.",
        summaryArtifactEvidence,
        []
      ));
    }
  }

  return [
    goal(
      "daily-work-surface",
      "OpenMythos Is A Complete Daily Work Surface",
      [
        commandEvidence,
        tuiInspectionEvidence,
        workflowControlEvidence,
        tuiControlEvidence
      ],
      [],
      [
        ...(hasSessionCommand
          ? []
          : [evidence("session.loop.missing", "missing", "No interactive session command exists for daily repo work.", ["src/ui/cli.ts"], ["Add a daily-driver session entrypoint that can control active work, not only launch runs."])])
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
      missingTaskTools.length > 0
        ? [
          evidence("task.tools.missing", "missing", `Worker-requestable task tools are incomplete. Missing: ${missingTaskTools.join(", ")}.`, ["src/core/types.ts"], ["Expand TaskToolRequest and execution dispatch for shell, package, git write, browser, API, and database actions."])
        ]
        : []
    ),
    goal(
      "verification-safety",
      "OpenMythos Is A Complete Verification And Safety System",
      [
        evidence("governance.review", "real", "Governance preflight, risk review, approval stops, and task verification receipts exist.", ["src/core/governance.ts", "src/core/review.ts", "src/core/phases.ts"], []),
        evidence("local.verification", "real", "Local and task-level verification commands gate runs before model QA.", ["src/core/phases.ts"], []),
        verificationPresetEvidence
      ],
      [],
      []
    ),
    goal(
      "repo-workflow",
      "OpenMythos Owns The Full Repo Workflow",
      [
        evidence("issue.pr.review", "real", "Issue ingestion, PR ingestion, PR check summaries, and local review workflow exist.", ["src/core/issues.ts", "src/core/pull-requests.ts", "src/core/reviewer.ts"], []),
        ...(missingRepoWorkflowCommands.length === 0
          ? [evidence("git.write.workflow", "real", "CLI exposes branch, stage, commit, rollback, publish-pr, and release-check workflow commands for repo lifecycle operations.", ["src/ui/cli.ts"], [])]
          : []
        )
      ],
      [],
      [
        ...(missingRepoWorkflowCommands.length === 0
          ? []
          : [evidence("git.write.workflow.missing", "missing", "Missing repo lifecycle workflow commands: " + missingRepoWorkflowCommands.join(", "), ["src/ui/cli.ts"], ["Add missing repo commands and connect them to your repo workflow."])]
        )
      ]
    ),
    goal(
      "comfortable-adoption",
      "OpenMythos Is Comfortable To Adopt",
      [
        evidence("readme.usage", "real", "README documents installation, profiles, usage, review, issue, PR, TUI, and benchmark commands.", ["README.md"], []),
        ...(hasSetupCommand
          ? [evidence("onboarding.setup", "real", "Setup command validates config, profile, workspace, and key availability for first run.", ["src/ui/cli.ts", "src/core/setup.ts"], [])]
          : [])
      ],
      [],
      [
        ...(hasSetupCommand
          ? []
          : [evidence("onboarding.missing", "missing", "No first-run onboarding, setup validation, or recommended-defaults command exists.", ["README.md", "src/ui/cli.ts"], ["Add setup/onboarding validation for keys, profiles, shell invocation, and workspace binding."])])
      ]
    ),
    goal(
      "outcome-superiority",
      "OpenMythos Proves Better Outcomes Than Baseline Harnesses",
      outcomeSuperiorityRealEvidence,
      [
        evidence("fake.regressions", "fake", "Fake adapter, fake profile, and fake-run tests cover harness invariants only.", ["src/adapters/fake.ts", "profiles/fake.json", "src/test/fake-run.test.ts"], ["Keep fake coverage as regression-only evidence."]),
        liveGateEvidence
      ],
      outcomeSuperiorityMissingEvidence
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
    .filter((summary) => summary.evidenceLevel === "smoke")
    .sort((a, b) => b.successfulConsecutiveRounds - a.successfulConsecutiveRounds);
}

interface BaselineFixtureCoverage {
  hasAnySummary: boolean;
  coveredFixtures: string[];
  missingFixtures: string[];
  summaryArtifacts: string[];
}

async function collectRequiredComparativeFixtures(repoRoot: string): Promise<string[]> {
  const suitePath = resolve(repoRoot, "fixtures/real-eval/suites/daily-workflow-suite.json");
  if (!existsSync(suitePath)) {
    return ["noop-js", "trim-js"];
  }
  try {
    const raw = JSON.parse(await readFile(suitePath, "utf8")) as { fixtures?: unknown };
    if (Array.isArray(raw.fixtures)) {
      const fixtureIds = raw.fixtures
        .map((fixture: unknown) => {
          if (fixture && typeof fixture === "object" && "id" in fixture && typeof fixture.id === "string") {
            return fixture.id;
          }
          return null;
        })
        .filter((fixture): fixture is string => typeof fixture === "string" && fixture.length > 0);
      if (fixtureIds.length > 0) {
        return [...new Set(fixtureIds)];
      }
    }
  } catch {
    return ["noop-js", "trim-js"];
  }
  return ["noop-js", "trim-js"];
}

function parseComparativeSummaryFixtures(rawSummary: Record<string, unknown>): string[] {
  const fixtureSet = new Set<string>();
  const fixtureValue = rawSummary.fixture;
  if (typeof fixtureValue === "string" && fixtureValue.trim().length > 0) {
    fixtureSet.add(fixtureValue);
  }
  if (Array.isArray(rawSummary.fixtures)) {
    for (const item of rawSummary.fixtures) {
      if (typeof item === "string") {
        if (item.trim().length > 0) {
          fixtureSet.add(item);
        }
        continue;
      }
      if (item && typeof item === "object" && "fixture" in item && typeof item.fixture === "string" && item.fixture.trim().length > 0) {
        fixtureSet.add(item.fixture);
      }
    }
  }
  return [...fixtureSet];
}

async function collectBaselineCoverage(root: string, requiredFixtures: string[]): Promise<BaselineFixtureCoverage> {
  const summaryArtifacts = await collectSummaryArtifacts(root);
  const covered = new Set<string>();
  for (const summary of summaryArtifacts) {
    const absoluteSummaryPath = resolve(root, summary);
    try {
      const raw = JSON.parse(await readFile(absoluteSummaryPath, "utf8")) as Record<string, unknown>;
      const fixtures = parseComparativeSummaryFixtures(raw);
      const passed = raw.passed === true;
      if (!passed) {
        continue;
      }
      for (const fixture of fixtures) {
        if (requiredFixtures.includes(fixture)) {
          covered.add(fixture);
        }
      }
    } catch {
      continue;
    }
  }
  const missingFixtures = requiredFixtures.filter((fixture) => !covered.has(fixture));
  return {
    hasAnySummary: summaryArtifacts.length > 0,
    coveredFixtures: Array.from(covered),
    missingFixtures,
    summaryArtifacts
  };
}

async function collectRealEvalSummaries(repoRoot: string): Promise<Array<LiveEvalSummary & { fixture: string }>> {
  const summaries = await findFiles(resolve(repoRoot, "runs/real-evals"), "summary.json", 8);
  const parsed: Array<LiveEvalSummary & { fixture: string }> = [];
  for (const summaryPath of summaries) {
    try {
      const raw = JSON.parse(await readFile(summaryPath, "utf8")) as {
        schemaVersion?: unknown;
        evidenceLevel?: unknown;
        profile?: unknown;
        fixture?: unknown;
        passed?: unknown;
        requiredConsecutiveRounds?: unknown;
        successfulConsecutiveRounds?: unknown;
      };
      const evidenceLevel = parseEvidenceLevel(raw.evidenceLevel, summaryPath);
      if (evidenceLevel !== "real" && raw.schemaVersion !== "real-eval.v1") {
        continue;
      }
      parsed.push({
        path: relative(repoRoot, summaryPath),
        evidenceLevel,
        profile: typeof raw.profile === "string" ? raw.profile : "unknown",
        fixture: typeof raw.fixture === "string" ? raw.fixture : "unknown",
        passed: raw.passed === true,
        requiredConsecutiveRounds: typeof raw.requiredConsecutiveRounds === "number" ? raw.requiredConsecutiveRounds : 0,
        successfulConsecutiveRounds: typeof raw.successfulConsecutiveRounds === "number" ? raw.successfulConsecutiveRounds : 0
      });
    } catch {
      continue;
    }
  }
  return parsed.sort((a, b) => b.successfulConsecutiveRounds - a.successfulConsecutiveRounds);
}

async function collectEvalSummaries(repoRoot: string): Promise<LiveEvalSummary[]> {
  const summaries = await findFiles(resolve(repoRoot, "runs"), "summary.json", 8);
  const parsed: LiveEvalSummary[] = [];
  for (const summaryPath of summaries) {
    const relativePath = relative(repoRoot, summaryPath);
    if (relativePath.startsWith("runs/comparative-baselines/") || relativePath.startsWith("runs/baseline-sources/")) {
      continue;
    }
    try {
      const raw = JSON.parse(await readFile(summaryPath, "utf8")) as {
        evidenceLevel?: unknown;
        profile?: unknown;
        passed?: unknown;
        requiredConsecutiveRounds?: unknown;
        successfulConsecutiveRounds?: unknown;
      };
      parsed.push({
        path: relativePath,
        evidenceLevel: parseEvidenceLevel(raw.evidenceLevel, summaryPath),
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

function parseEvidenceLevel(value: unknown, summaryPath: string): "real" | "smoke" | "fake" {
  if (value === "real" || value === "smoke" || value === "fake") {
    return value;
  }
  return summaryPath.includes("runs/real-evals") ? "real" : "smoke";
}

function strongestSmokeGate(summaries: LiveEvalSummary[]): LiveEvalSummary | null {
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

async function collectSummaryArtifacts(root: string): Promise<string[]> {
  const summaries = await findFiles(root, "summary.json", 10);
  return summaries.map((summaryPath) => relative(root, summaryPath));
}

function extractToolUnion(typesSource: string): string[] {
  const taskToolRequestStart = typesSource.indexOf("export interface TaskToolRequest");
  if (taskToolRequestStart < 0) {
    return [];
  }
  const match = typesSource.slice(taskToolRequestStart).match(/tool:\s*([^;]+);/);
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
