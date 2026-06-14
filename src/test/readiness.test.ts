import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildReadinessReport } from "../core/readiness.js";
import type { EvidenceItem, EvidenceLevel } from "../core/readiness.js";

test("buildReadinessReport separates fake regression evidence from product evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmythos-readiness-"));
  await mkdir(resolve(root, "src/adapters"), { recursive: true });
  await mkdir(resolve(root, "src/test"), { recursive: true });
  await mkdir(resolve(root, "profiles"), { recursive: true });
  await mkdir(resolve(root, "src/ui"), { recursive: true });
  await mkdir(resolve(root, "src/core"), { recursive: true });
  await mkdir(resolve(root, "docs/plans"), { recursive: true });
  await mkdir(resolve(root, "runs/live-evals/eval-1"), { recursive: true });
  await writeFile(resolve(root, "src/adapters/fake.ts"), "export class FakeAdapter {}\n", "utf8");
  await writeFile(resolve(root, "profiles/fake.json"), "{}\n", "utf8");
  await writeFile(resolve(root, "src/test/fake-run.test.ts"), "test('fake', () => {})\n", "utf8");
  await writeFile(resolve(root, "src/ui/cli.ts"), 'program.command("run"); program.command("tui"); .option("-p, --profile <nameOrPath>", "Config profile overlay", "fake")\n', "utf8");
  await writeFile(resolve(root, "src/ui/tui.ts"), "Keys: j/down next | k/up previous | r refresh | q quit\n", "utf8");
  await writeFile(resolve(root, "src/core/types.ts"), 'export interface TaskToolRequest { tool: "filesystem.read" | "verification.command"; }\n', "utf8");
  await writeFile(resolve(root, "src/core/phases.ts"), "task-tool-turns\n", "utf8");
  await writeFile(resolve(root, "src/core/governance.ts"), "governance\n", "utf8");
  await writeFile(resolve(root, "src/core/review.ts"), "review\n", "utf8");
  await writeFile(resolve(root, "src/core/issues.ts"), "issues\n", "utf8");
  await writeFile(resolve(root, "src/core/pull-requests.ts"), "pulls\n", "utf8");
  await writeFile(resolve(root, "src/core/reviewer.ts"), "reviewer\n", "utf8");
  await writeFile(resolve(root, "README.md"), "usage\n", "utf8");
  await writeFile(resolve(root, "docs/plans/2026-06-14-openmythos-2027-default-harness-roadmap.md"), "roadmap\n", "utf8");
  await writeFile(resolve(root, "runs/live-evals/eval-1/summary.json"), JSON.stringify({
    passed: true,
    requiredConsecutiveRounds: 3,
    successfulConsecutiveRounds: 3,
    profile: "zai-live-gate"
  }, null, 2), "utf8");

  const report = await buildReadinessReport(root);
  const superiority = report.productGoals.find((goal) => goal.id === "outcome-superiority");

  assert.equal(report.fakeSurface.fakeAdapter, "src/adapters/fake.ts");
  assert.equal(report.fakeSurface.fakeProfile, "profiles/fake.json");
  assert.equal(report.fakeSurface.fakeRunTest, "src/test/fake-run.test.ts");
  assert.equal(report.fakeSurface.fakeDefaultEval, true);
  assert.equal(report.liveEvalSummaries.length, 1);
  assert.equal(report.summary.smokeEvidenceCount >= 1, true);
  assert.equal(superiority?.fakeEvidence.some((item) => item.id === "fake.regressions"), true);
  assert.equal(superiority?.fakeEvidence.some((item) => item.id === "live.zai.marker_gate"), true);
  assert.equal(superiority?.missingEvidence.some((item) => item.id === "comparative.baselines.missing"), true);
  assert.equal(superiority?.realEvidence.every((item) => item.id !== "live.zai.marker_gate"), true);
  assert.ok(report.summary.missingEvidenceCount > 0);
});

test("outcome-superiority real evidence contains only real evidence items", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmythos-readiness-evidence-"));
  await mkdir(resolve(root, "src/core"), { recursive: true });
  await mkdir(resolve(root, "src/adapters"), { recursive: true });
  await mkdir(resolve(root, "src/ui"), { recursive: true });
  await mkdir(resolve(root, "src/test"), { recursive: true });
  await mkdir(resolve(root, "profiles"), { recursive: true });
  await mkdir(resolve(root, "fixtures/real-eval/noop-js"), { recursive: true });
  await mkdir(resolve(root, "docs/plans"), { recursive: true });
  await mkdir(resolve(root, "runs/live-evals/eval-1"), { recursive: true });
  await mkdir(resolve(root, "runs/real-evals/eval-1"), { recursive: true });
  await writeFile(resolve(root, "src/core/real-eval.ts"), "export class RealEval {}\n", "utf8");
  await writeFile(resolve(root, "fixtures/real-eval/noop-js/manifest.json"), "{}\n", "utf8");
  await writeFile(resolve(root, "src/adapters/fake.ts"), "export class FakeAdapter {}\n", "utf8");
  await writeFile(resolve(root, "profiles/fake.json"), "{}\n", "utf8");
  await writeFile(resolve(root, "src/test/fake-run.test.ts"), "test('fake', () => {})\n", "utf8");
  await writeFile(resolve(root, "src/ui/cli.ts"), 'program.command("run"); program.command("tui"); .option("-p, --profile <nameOrPath>", "Config profile overlay", "fake")\n', "utf8");
  await writeFile(resolve(root, "src/ui/tui.ts"), "Keys: j/down next | k/up previous | r refresh | q quit\n", "utf8");
  await writeFile(resolve(root, "src/core/types.ts"), 'export interface TaskToolRequest { tool: "filesystem.read" | "verification.command"; }\n', "utf8");
  await writeFile(resolve(root, "src/core/phases.ts"), "task-tool-turns\n", "utf8");
  await writeFile(resolve(root, "src/core/governance.ts"), "governance\n", "utf8");
  await writeFile(resolve(root, "src/core/review.ts"), "review\n", "utf8");
  await writeFile(resolve(root, "src/core/issues.ts"), "issues\n", "utf8");
  await writeFile(resolve(root, "src/core/pull-requests.ts"), "pulls\n", "utf8");
  await writeFile(resolve(root, "src/core/reviewer.ts"), "reviewer\n", "utf8");
  await writeFile(resolve(root, "README.md"), "usage\n", "utf8");
  await writeFile(resolve(root, "docs/plans/2026-06-14-openmythos-2027-default-harness-roadmap.md"), "roadmap\n", "utf8");
  await writeFile(resolve(root, "runs/live-evals/eval-1/summary.json"), JSON.stringify({
    passed: true,
    requiredConsecutiveRounds: 3,
    successfulConsecutiveRounds: 3,
    profile: "zai-live-gate",
    evidenceLevel: "smoke"
  }, null, 2), "utf8");
  await writeFile(resolve(root, "runs/real-evals/eval-1/summary.json"), JSON.stringify({
    evidenceLevel: "real",
    fixture: "noop-js",
    passed: true,
    requiredConsecutiveRounds: 3,
    successfulConsecutiveRounds: 3,
    profile: "zai-5"
  }, null, 2), "utf8");

  const report = await buildReadinessReport(root);
  const superiority = report.productGoals.find((goal) => goal.id === "outcome-superiority");
  for (const item of superiority?.realEvidence ?? []) {
    assertEvidenceShape(item);
    assert.equal(item.level, "real");
  }
});

function assertEvidenceShape(value: unknown): asserts value is EvidenceItem {
  assert.equal(typeof value === "object" && value !== null, true);
  const candidate = value as {
    id?: unknown;
    level?: unknown;
    summary?: unknown;
    artifacts?: unknown;
    nextActions?: unknown;
  };
  assert.equal(typeof candidate.id, "string");
  assert.equal(["real", "fake", "missing"].includes(candidate.level as EvidenceLevel), true);
  assert.equal(typeof candidate.summary, "string");
  assert.equal(Array.isArray(candidate.artifacts), true);
  assert.equal(Array.isArray(candidate.nextActions), true);
}
