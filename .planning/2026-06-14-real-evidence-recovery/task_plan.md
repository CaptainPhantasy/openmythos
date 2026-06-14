# Task Plan: Real Evidence Recovery

## Goal

Replace fake-product claims with real verification paths so OpenMythos can only advance toward default-harness readiness through functional code, retained real-run evidence, and comparative benchmarks.

## Current Phase

Phase 2

## Phases

### Phase 1: Evidence Inventory And Classification

- [x] Run the project readiness audit.
- [x] Identify fake evidence that must remain regression-only.
- [x] Identify real evidence that is too narrow to prove product readiness.
- [x] Record findings for the next worker.
- **Status:** complete

### Phase 2: Real Benchmark Harness

- [x] Add an outcome-superiority evidence-shape regression guard so raw summary objects cannot be promoted as real evidence.
- [x] Define a retained artifact schema for real repo task suites, runs, and score fields.
- [x] Add fixture repositories or reproducible repo snapshots that require real code edits and tests.
- [x] Keep benchmark evidence in retained fixture/suite artifacts and require non-fake profiles.
- [x] Add a command that runs the real benchmark suite and stores receipts under a real-evidence path.
- **Status:** complete

### Phase 3: Replace Narrow Live Gates With Real Repo Tasks

- [ ] Convert the current live gate into at least one real repository workflow task.
- [ ] Require non-fake model profiles for live product evidence.
- [ ] Store model, endpoint, task, diff, verification command, and result artifacts together.
- [ ] Keep live marker-file gates only as smoke coverage, not product support.
- **Status:** pending

### Phase 4: Expand Real Worker Actions

- [ ] Add or wire real task-loop actions for shell, package manager, git write, browser/UI verification, API, and database flows where appropriate.
- [ ] Gate risky actions through explicit policy and retained receipts.
- [ ] Verify those actions against real fixture tasks before claiming parity.
- **Status:** pending

### Phase 5: Product Readiness Promotion Gate

- [ ] Update `readiness` so no product goal is marked supported without real or comparative evidence.
- [ ] Add comparative baseline artifacts for direct Claude Code and Codex runs when available.
- [ ] Require the readiness report to distinguish fake regression coverage from product support.
- [ ] Document the exact command sequence a release worker must run before tagging.
- **Status:** pending

## Key Questions

1. Which benchmark tasks best represent daily Claude Code or Codex repo work without depending on private user projects?
2. What artifact schema is sufficient to prove a real task: input goal, repo state, model/profile, diff, commands run, outputs, and final score?
3. Which worker action families must exist before the TUI can honestly become an execution surface instead of an inspection surface?
4. What comparative baseline process is practical enough to rerun before releases?

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Fake profiles and `FakeAdapter` remain regression tools only. | They are useful for deterministic control-flow tests, but they cannot prove daily-driver capability or product readiness. |
| Readiness output is the first command for future workers. | It exposes fake, real, comparative, and missing evidence in one place and prevents drift back into claim-first development. |
| Real product evidence must use retained run artifacts. | A future worker must be able to inspect exactly what happened without relying on chat history or model narration. |
| Marker-file live gates are smoke tests, not proof. | They prove that a live model can respond through the harness, but not that OpenMythos can perform real repository work. |
| TUI expansion waits behind real execution proof. | A comfortable UI around fake or incomplete capability would make the product feel better without making it more true. |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| Prior roadmap work over-weighted fake tests and fake surfaces as confidence signals. | 1 | Added a readiness audit and this persistent planning file to keep fake evidence classified as regression-only. |

## Notes

- Start every continuation with `npm run cli -- readiness --workdir .`.
- Do not count `src/test/fake-run.test.ts`, `profiles/fake.json`, or `src/adapters/fake.ts` as product evidence.
- Do not remove fake tests unless they are actively blocking real evidence. They are still useful for deterministic regression coverage.
- New product claims must point to real artifacts, preferably under `runs/real-evals/` or a similarly explicit retained-evidence path.
- Comparative claims require retained Claude Code and Codex baseline artifacts, not intuition.
