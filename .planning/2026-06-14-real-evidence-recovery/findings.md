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
- The long-form product goal remains unchanged for 2027: a developer can use OpenMythos as their primary coding harness with workflow continuity and retained evidence showing equal or better outcomes than baseline Claude Code/Codex usage.
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
| model tool approvals path (`src/core/phases.ts`, `src/adapters/fake.ts`, `src/core/review.ts`) | Controlled regression | Keep as the minimum-risk enforcement test that proves high-risk operations do not write before approval. |

## Real Testing That Must Replace The Fake Confidence

- Real repo task benchmarks: reproducible tasks that require actual code changes, test execution, and retained diffs.
- Real tool-action tests: worker-loop tasks that exercise shell, package manager, git write, browser/UI verification, API, and database capabilities as those actions are added.
- Real safety regression: at least one test must prove a high-risk model tool request raises enforce-mode approval and emits a tool-approval artifact before any output mutation.
- Real verification receipts: every real task must retain the command, output, exit code, diff, model/profile, and final scoring artifact.
- Comparative baselines: direct Claude Code and Codex task results must be stored beside OpenMythos results before superiority is claimed.
- Readiness promotion: `readiness` must remain conservative and fail product support when evidence is fake, missing, or only a marker-file gate.

## Current Capability State (2026-06-14)

Current gains:

- Repo lifecycle workflow commands (`branch`, `stage`, `commit`, `rollback`, `publish-pr`, `release-check`) now exist and are detected by readiness as real product evidence.
- Readiness now distinguishes real outcomes from missing comparative baselines and refuses to award baseline superiority claims without present evidence.
- The TUI now sorts artifacts by operator value, defaults focus to review/diff artifacts, previews artifact content inline, and supports `[` / `]` artifact navigation instead of only listing filenames.
- The session-native daily-driver path is now real: `session --tui` starts the run immediately, the TUI can observe the run while it is active, and the selected run now shows phase progress, task progress, latest task receipt, and latest event before final metrics are available.
- Benchmark aggregation now tolerates legacy metrics with missing newer counters, so the TUI bench summary no longer prints `NaN` when older retained runs are present.
- The live `awaiting_approval` operator path is now proven: approving from the TUI resumes the run to `completed`, and cancelling from the TUI ends the run in `failed` with the retained run state and selected-run surface in agreement.
- Retained metrics and bench status counts now track those non-happy-path transitions honestly: `cancel`, `reject`, and `queue` sync `metrics.json` from runner state, and the dashboard status-count summary derives failed/awaiting counts from live run state when older retained metrics are stale.
- Queue and replay from the retained-run TUI surface are now honest: queueing archives the previous active artifacts, shows a distinct `queued` state with zeroed active metrics/progress, and replay restarts from a clean run surface instead of reusing the old plan, execution, and QA artifacts.
- Transient atomic-write files such as `state.json.tmp-*` are now filtered out of artifact browsing so replay does not leak internal write mechanics into the operator surface.
- Archived attempt history is now first-class in the TUI: the dashboard lists current and historical attempts, supports `{` / `}` attempt navigation, and switches progress, metrics, events, and artifact preview to the selected attempt.
- Retained history created before archived `state.json` support is now still inspectable: `StateStore.loadAttemptState()` reconstructs legacy attempt state from archived `metrics.json`, events, and `attempt.json` fallback data so older `.history` directories no longer render as `status=missing`.
- Attempt-to-attempt comparison is now first-class in the TUI: the dashboard shows a baseline attempt, relation (`older` or `newer`), status/phase context, metric deltas, event-count delta, and artifact-set delta sourced directly from retained attempt artifacts.
- Artifact-to-artifact comparison is now first-class in the TUI: for the selected artifact, the dashboard compares against the same artifact path in the baseline attempt and shows `added`, `changed`, or `unchanged`, plus line counts, differing-line count, and concrete preview pairs from retained artifact text.

Remaining high-impact gaps:

- Superiority still cannot be claimed because Claude Code comparative coverage remains incomplete for the daily workflow suite.
- The remaining comparative blocker is specifically Claude Code coverage for the `trim-js` fixture; readiness still reports `comparative.claude.coverage.missing`.
- Repo search confirms the current Claude comparative import still contains only `noop-js` under `runs/comparative-baselines/claude-code/smoke-test/summary.json`; there is no retained `trim-js` Claude baseline in the worktree to import or promote honestly.
- After comparative coverage is fixed, the next honest comfort improvement is richer patch-aware diff ergonomics and task-level replay targeting. The harness now explains both attempt-level and artifact-level rerun deltas, but the operator still cannot jump directly to “replay only the failed or changed task” from the TUI surface.

### Phase 4 Correction (2026-06-14 18:41 UTC)

**Task-loop actions are already wired.** The findings at line 49 were stale. Verified through code inspection:

| Tool | Catalog Entry | Implementation | Risk Gate |
|------|--------------|----------------|-----------|
| `shell.run` | tooling.ts:50 | phases.ts:952 → `executeShell()` | phases.ts:1042 (destructive ops → high) |
| `package.install` | tooling.ts:55 | phases.ts:956 → `executePackageInstallTool()` | phases.ts:1051 (global → high) |
| `git.branch` | tooling.ts:60 | phases.ts:960 → `executeGitBranchTool()` | phases.ts:1062 (delete → high) |
| `git.stage` | tooling.ts:65 | phases.ts:964 → `executeGitStageTool()` | phases.ts:1070 (low) |
| `git.commit` | tooling.ts:70 | phases.ts:968 → `executeGitCommitTool()` | phases.ts:1077 (always high) |
| `browser.verify` | tooling.ts:75 | phases.ts:972 → curl-based HTTP fetch | phases.ts:1093 (low) |
| `api.request` | tooling.ts:80 | phases.ts:976 → `executeCommand("curl")` | phases.ts:1081 (non-GET → high) |
| `database.query` | tooling.ts:85 | phases.ts:980 → JSON file query engine | phases.ts:1093 (low) |

**Evidence:**
- 71/71 tests pass (including real-eval.test.ts, tooling.test.ts)
- `assessRealEvalFixture` exercises shell + verification commands against real fixture repos
- `normalizePlanTools` validates all tool catalog aliases and role permissions
- `readiness.ts:198` expects exactly these 8 task tools and detects missing ones

**Phase 4 remaining items verified.** The "Add or wire real task-loop actions" task was already complete; the "Verify those actions against real fixture tasks" task was confirmed through test execution (9/9 real-eval + tooling tests pass).

### Config Discovery And Onboarding Correction (2026-06-14 20:28 UTC)

The default-config adoption path had a real product defect: relative config
lookup could fall back to the shell cwd and produce `Config file not found:
/openmythos.config.json` even when a valid repo-root config existed above the
target workdir.

This is now corrected:

| Surface | Change | Evidence |
|---------|--------|----------|
| `src/config/discovery.ts` | Shared config discovery now walks up from `--workdir` first, then shell cwd, for simple default config names. | `npm test` includes `discoverConfigPath walks workdir ancestors for the default config filename` |
| `src/ui/cli.ts` | Runtime and real-eval entrypoints now use shared discovery and return searched-path context on failure. | `CLI run discovers config from a workdir ancestor when launched outside the repo` |
| `src/core/setup.ts` | Setup JSON now reports `configPath`, `configSearchPaths`, and `configSource`. | Live CLI run from `/` resolved repo-root config through `workdir-ancestor` |
| `README.md` + `openmythos.config.example.json` | First-run docs now point to a real example config file and explain upward discovery. | File exists and setup recommendation is no longer pointing at a missing template |

**Live proof:** from `/`, running `node /Volumes/Storage/OpenMythos/dist/index.js setup --workdir /Volumes/Storage/OpenMythos/src --profile fake --json` now resolves `/Volumes/Storage/OpenMythos/openmythos.config.json` and reports the searched path list instead of failing on `/openmythos.config.json`.

**Readiness impact:** `npm run cli -- readiness --workdir .` now reports `supportedCount: 5`, `partialCount: 1`. The only remaining product gap is comparative outcome-superiority evidence.

### Phase 5 Status (Blocked)

- **Real benchmark suite:** Timed out with `zai-live-gate` profile — needs live Z.AI API endpoint with adequate timeout configuration.
- **Comparative baselines:** `runs/comparative-baselines/claude-code/` and `runs/comparative-baselines/codex/` directories created. Need real Claude Code and Codex runs on the same fixtures to populate.
- **TUI confidence:** Approve, cancel, reject, queue, and replay are now verified on real retained-run surfaces, and queue no longer leaves stale metrics/progress masquerading as an active run.
- **TUI confidence:** Attempt-history and replay-lineage visibility are now verified on real retained-run surfaces, including a fresh queue-created archive and a legacy archive fallback that previously rendered as `status=missing`.
- **TUI confidence:** Attempt-comparison summaries are now verified on real retained-run surfaces for both current-vs-history and history-vs-current selection paths.
- **TUI confidence:** Artifact-comparison summaries are now verified on real retained-run surfaces for both changed shared artifacts (`state.json`) and baseline-missing artifacts (`review-task-1.patch`).
- `ready for default-harness` behavior is still blocked until superiority benchmarks are populated with Claude Code and Codex retained baselines.
- The remaining TUI comfort work is no longer basic control viability, history visibility, or missing content comparison; it is more targeted rerun control and stronger patch ergonomics on top of the retained comparison surface.
- Release-worker documentation is now present in README as an explicit pre-tag command sequence; that Phase 5 item is no longer missing.

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
