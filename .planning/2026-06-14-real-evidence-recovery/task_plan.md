# Task Plan: Real Evidence Recovery

## Goal

Replace fake-product claims with real verification paths so OpenMythos can only advance toward default-harness readiness through functional code, retained real-run evidence, and comparative benchmarks.

## Current Phase

Phase 5

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

- [x] Convert the current live gate into at least one real repository workflow task.
- [x] Require non-fake model profiles for live product evidence.
- [x] Store model, endpoint, task, diff, verification command, and result artifacts together.
- [x] Keep live marker-file gates only as smoke coverage, not product support.
- [x] Add direct CLI workflow for real repository workflow execution in user-facing docs and readiness classification.
- **Status:** complete

### Phase 4: Expand Real Worker Actions

- [x] Add first-run onboarding validation and a dedicated daily session entrypoint with real setup checks.
- [x] Add repo lifecycle command surface (branch, stage, commit, rollback, publish-pr, release-check) so users can perform local write actions without leaving the harness command set.
- [x] Add or wire real task-loop actions for shell, package manager, git write, browser/UI verification, API, and database flows where appropriate.
- [x] Gate risky model-tool actions through explicit policy and retained approval artifacts.
- [x] Verify those actions against real fixture tasks before claiming parity.
- [x] Document and enforce the full 2027 default-harness goal: a user can complete Claude Code/Codex-style coding workflows with preserved intent, safety, and superior outcomes within the terminal UI.
- **Status:** complete

### Phase 5: Product Readiness Promotion Gate

- [x] Update `readiness` so no product goal is marked supported without real or comparative evidence.
- [ ] Add comparative baseline artifacts for direct Claude Code and Codex runs when available.
- [x] Require the readiness report to distinguish fake regression coverage from product support.
- [x] Document the exact command sequence a release worker must run before tagging.
- **Status:** in progress

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
| Live TUI control claims require runtime proof, not hotkey presence. | Approve and cancel only became product evidence after `session --tui` showed the retained run state, metrics, and dashboard all agreed on the transition. |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| Prior roadmap work over-weighted fake tests and fake surfaces as confidence signals. | 1 | Added a readiness audit and this persistent planning file to keep fake evidence classified as regression-only. |
| Retained `metrics.json` could stay at `awaiting_approval` after `cancel`, `reject`, or `queue`. | 1 | Synced retained metrics state from runner state transitions in `src/core/runner.ts` and added regression coverage in `src/test/fake-run.test.ts`. |
| TUI bench status counts could misreport failed vs awaiting runs when older retained metrics were stale. | 1 | Switched the dashboard status-count summary to derive run counts from live run state in `src/ui/tui.ts` and added regression coverage in `src/test/tui.test.ts`. |
| Queueing a completed run from the TUI could leave it looking `running` while still showing stale completion artifacts. | 1 | Introduced an explicit `queued` run state, archived prior run artifacts under `.history`, and restarted replay from a clean active artifact surface. |
| Atomic write temp files like `state.json.tmp-*` could briefly leak into the TUI artifact list during replay. | 1 | Filtered transient `.tmp-` artifacts out of `StateStore.listArtifacts()` and added regression coverage in `src/test/state.test.ts`. |
| Archived attempts created before the new `state.json` write could render as `status=missing` in the TUI. | 1 | Reconstructed legacy attempt state from archived `metrics.json`, events, and `attempt.json` fallback data in `src/state/store.ts`, then verified the old retained workdir now renders `status=completed phase=complete`. |
| Archived attempts were navigable but still required manual reasoning to understand rerun deltas. | 1 | Added attempt-to-attempt comparison summaries in `src/ui/tui.ts` so the TUI now shows baseline attempt, status/phase context, metric deltas, event deltas, and artifact-set deltas from retained run evidence. |
| Attempt comparison still stopped at counts and required manual artifact inspection to see what actually changed in a rerun. | 1 | Added artifact-level comparison in `src/ui/tui.ts` so the TUI now compares the selected artifact against the baseline attempt and shows changed/added status, line counts, differing-line count, and preview pairs from retained artifact text. |

## Notes

- Start every continuation with `npm run cli -- readiness --workdir .`.
- Before any continuation that starts execution in a model context, open and follow
  `.planning/2026-06-14-real-evidence-recovery/next-worker-runbook.md`.
- Do not count `src/test/fake-run.test.ts`, `profiles/fake.json`, or `src/adapters/fake.ts` as product evidence.
- Do not remove fake tests unless they are actively blocking real evidence. They are still useful for deterministic regression coverage.
- New product claims must point to real artifacts, preferably under `runs/real-evals/` or a similarly explicit retained-evidence path.
- Comparative claims require retained Claude Code and Codex baseline artifacts, not intuition.
- The TUI is no longer filename-only: it now exposes focused artifact preview and artifact navigation. Do not regress that surface while pursuing later comfort-gate work.
- The session-native operator loop is now live: `session --tui` starts the run immediately, refreshes into the active/completed state, and surfaces progress data from plan/execution artifacts.
- The `awaiting_approval`, reject, queue, replay, archived-attempt navigation, attempt-comparison, and artifact-comparison paths now have real operator proof. The remaining formal product gate is still comparative baseline evidence, and the next comfort slice after that is richer patch-aware diff ergonomics rather than missing comparison capability.
