# Findings & Decisions

## Requirements

- Use the `planning-with-files` workflow so the fake-testing correction persists outside chat.
- Instruct the next worker how to fix fake-testing damage with real testing.
- Keep the full product goal from the roadmap, not a reduced MVP or beta target.
- Preserve fake tests only as regression scaffolding unless they become actively harmful.
- Prevent future workers from treating fake tests, fake profiles, or marker-file gates as product readiness evidence.

## Research Findings

- The repository had no existing `.planning` directory before this work.
- The current product roadmap is `docs/plans/2026-06-14-openmythos-2027-default-harness-roadmap.md`.
- The roadmap already defines the product-complete target: OpenMythos must become a terminal-native daily coding harness that a Claude Code or Codex user can adopt without losing capability or comfort, and with measured improvement in verified outcomes.
- The roadmap evidence hierarchy correctly separates `fake`, `real`, and `comparative` evidence.
- The `readiness` command is the right guardrail for future workers because it classifies fake evidence and missing product proof directly against the roadmap.

## Current Fake Or Narrow Evidence Surfaces

| Surface | Classification | Required Treatment |
|---------|----------------|--------------------|
| `src/adapters/fake.ts` | Fake regression scaffold | Keep for deterministic tests only. Never cite as product support. |
| `profiles/fake.json` | Fake regression profile | Keep for local control-flow coverage only. Never use in product-readiness runs. |
| `src/test/fake-run.test.ts` | Fake regression test | Keep only as invariant coverage for schema, retries, receipts, and control flow. |
| Fake-profile eval summaries | Fake retained artifacts | Keep as historical regression artifacts; do not count toward readiness. |
| Live marker-file gate | Narrow real smoke evidence | Useful for endpoint/profile smoke, but insufficient for repo-work capability. |

## Real Testing That Must Replace The Fake Confidence

- Real repo task benchmarks: reproducible tasks that require actual code changes, test execution, and retained diffs.
- Real tool-action tests: worker-loop tasks that exercise shell, package manager, git write, browser/UI verification, API, and database capabilities as those actions are added.
- Real verification receipts: every real task must retain the command, output, exit code, diff, model/profile, and final scoring artifact.
- Comparative baselines: direct Claude Code and Codex task results must be stored beside OpenMythos results before superiority is claimed.
- Readiness promotion: `readiness` must remain conservative and fail product support when evidence is fake, missing, or only a marker-file gate.

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Use `.planning/2026-06-14-real-evidence-recovery/` as the active planning record. | It follows the planning skill pattern and makes the next phase resumable. |
| Link the roadmap to the active planning record. | The roadmap states the product goal; the active plan tells workers how to repair evidence quality. |
| Avoid changing production code in this planning pass. | The user asked for a planning skill handoff; the next implementation phase should start from a clear plan and readiness output. |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Planning state did not exist in the repo. | Created `.planning/.active_plan` and a dated plan directory. |
| Prior work risked letting fake evidence shape product confidence. | Defined fake evidence as regression-only and required real/comparative artifacts for product claims. |

## Resources

- Active roadmap: `docs/plans/2026-06-14-openmythos-2027-default-harness-roadmap.md`
- Active plan: `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
- Readiness implementation: `src/core/readiness.ts`
- Readiness tests: `src/test/readiness.test.ts`
- CLI command: `src/ui/cli.ts`

## Visual/Browser Findings

- No browser or visual findings were used for this planning pass.
