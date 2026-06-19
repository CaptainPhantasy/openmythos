# Progress Log

## Session: 2026-06-14 (artifact comparison inside attempt lineage)

### Roadmap Comfort Gate Progress

- **Status:** complete for this slice
- **Started:** 2026-06-14
- Actions taken:
  - Confirmed the formal product blocker is still external retained evidence: repo search still shows only `noop-js` under `runs/comparative-baselines/claude-code/smoke-test/summary.json`, with no retained Claude `trim-js` baseline available to import honestly.
  - Implemented selected-artifact comparison in `src/ui/tui.ts` so the dashboard now compares the focused artifact against the same path in the baseline attempt instead of leaving content deltas to manual filesystem inspection.
  - Added a dedicated `Artifact Comparison` section that shows:
    - baseline attempt label and relation (`older` or `newer`)
    - `added`, `changed`, or `unchanged` status
    - selected/baseline line counts
    - differing-line count
    - preview pairs from retained artifact text
  - Kept artifact comparison valid for both current-to-history and history-to-current selection paths.
  - Added regression coverage for the empty comparison state and for archived-history artifact comparison rendering.
- Verification:
  - `node dist/index.js readiness --workdir .` → expected partial gate:
    - `supportedCount: 5`
    - `partialCount: 1`
    - remaining missing evidence: `comparative.claude.coverage.missing`
  - `npm run build` → pass
  - `npm test` → pass, `91/91`
  - Static queued current-attempt artifact proof:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-history.YXGeTG --once`
    - rendered:
      - `Artifact Comparison`
      - `status: changed`
      - `lines: selected=14 baseline=21`
      - `differing lines: 17`
  - Static legacy-workdir artifact proof:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-queue-fix.Ub7xV1/workdir --once`
    - rendered:
      - `Artifact Comparison`
      - `status: unchanged`
      - `lines: selected=6 baseline=6`
      - `differing lines: 0`
  - Live selected-history artifact proof:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-history.YXGeTG`
    - after pressing `}`, the surface rendered:
      - `Artifact Comparison`
      - `baseline: current (newer attempt)`
      - `status: added`
      - `lines: selected=6 baseline=0`
      - `differing lines: 6`
- Files created/modified:
  - `src/ui/tui.ts`
  - `src/test/tui.test.ts`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Session: 2026-06-14 (attempt comparison and lineage summary)

### Roadmap Comfort Gate Progress

- **Status:** complete for this slice
- **Started:** 2026-06-14
- Actions taken:
  - Confirmed the formal product blocker is still external retained evidence: repo search found only `noop-js` under `runs/comparative-baselines/claude-code/smoke-test/summary.json`, with no retained Claude `trim-js` baseline available to import honestly.
  - Implemented attempt-to-attempt comparison in `src/ui/tui.ts` so the dashboard now derives comparison output from retained attempt metrics, events, and artifact sets instead of leaving rerun lineage as manual operator work.
  - Added a dedicated `Attempt Comparison` section that shows:
    - baseline attempt label and relation (`older` or `newer`)
    - baseline status/phase
    - duration, QA, file-edit, patch-edit, task-verification, and event-count deltas
    - added/removed artifact summaries
  - Kept comparison logic attempt-aware for both current-to-history and history-to-current navigation.
  - Added regression coverage for both the single-attempt empty state and the archived-history comparison state.
- Verification:
  - `npm run build` → pass
  - `npm test` → pass, `91/91`
  - Static current-attempt comparison proof on queued workdir:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-history.YXGeTG --once`
    - rendered:
      - `Attempt Comparison`
      - `baseline: queue@2026-06-14T21:22:29.895Z (older attempt)`
      - `events delta: -6`
      - `artifacts delta: +0 / -13`
  - Static legacy-workdir comparison proof:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-queue-fix.Ub7xV1/workdir --once`
    - rendered:
      - `baseline: history@queue-2026-06-14T21-11-14-635Z (older attempt)`
      - `duration_ms delta: +49`
      - `artifacts delta: +1 / -0`
      - `added vs baseline: state.json`
  - Live selected-history comparison proof:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-history.YXGeTG`
    - after pressing `}`, the surface rendered:
      - `Selected Attempt` → `kind: history`, `status: completed`, `reason: queue`
      - `Attempt Comparison`
      - `baseline: current (newer attempt)`
      - `events delta: +6`
      - `artifacts delta: +13 / -0`
      - `added vs baseline: review-task-1.patch, events.jsonl, execution.json, governance.json ... +9 more`
- Files created/modified:
  - `src/ui/tui.ts`
  - `src/test/tui.test.ts`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Session: 2026-06-14 (attempt-history TUI and legacy archive fallback)

### Roadmap Comfort Gate Progress

- **Status:** complete for this slice
- **Started:** 2026-06-14
- Actions taken:
  - Finished the TUI conversion from single-attempt inspection to first-class attempt history by adding current/history attempt selection to the dashboard model in `src/ui/tui.ts`.
  - Added `{` / `}` and left/right attempt navigation, plus an explicit `r` refresh handler so the key legend matches live behavior.
  - Extended the dashboard to render `Attempts` and `Selected Attempt` sections and to switch progress, metrics, events, and focused artifact preview to the selected attempt.
  - Added `StateStore.listAttempts()`, archived-attempt artifact reads, and attempt-aware event/artifact access to support history browsing without dropping to the filesystem.
  - Fixed a retained-run migration defect: legacy `.history` directories created before archived `state.json` support now reconstruct state from archived `metrics.json`, events, and `attempt.json` fallback data instead of rendering `status=missing`.
  - Added regression coverage for archived attempt rendering and legacy history fallback.
- Verification:
  - `npm run build` → pass
  - `npm test` → pass, `91/91`
  - Fresh retained-run proof:
    - `node dist/index.js run --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-history.YXGeTG "fresh history proof"`
    - returned `runId: 66c077ea-0f8c-4ae8-aa4d-0240fa2cc11a`, `status: "completed"`
  - Live TUI queue proof on the fresh run:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-history.YXGeTG`
    - after pressing `p`, the surface rendered:
      - `runs=1 completed=0 failed=0 awaiting=0 queued=1`
      - `status: queued`
      - `Attempts` showing both `current` and `queue@2026-06-14T21:22:29.895Z`
      - `Run Metrics` → `No metrics.json found.`
  - Live TUI history-navigation proof on the same run:
    - after pressing `}`, the selected attempt switched to:
      - `id: queue-2026-06-14T21-22-29-889Z`
      - `kind: history`
      - `status: completed`
      - `phase: complete`
      - `reason: queue`
      - historical `metrics.json`, events, and `review-task-1.patch` preview became active in the surface
  - Legacy retained-run fallback proof:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-queue-fix.Ub7xV1/workdir --once`
    - the old archive that previously showed `history@... status=missing` now renders `history@queue-2026-06-14T21-11-14-635Z status=completed phase=complete`
- Files created/modified:
  - `src/ui/tui.ts`
  - `src/state/store.ts`
  - `src/state/types.ts`
  - `src/test/tui.test.ts`
  - `src/test/state.test.ts`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Session: 2026-06-14 (queued/replay retained-run fix)

### Roadmap Comfort Gate Progress

- **Status:** complete for this slice
- **Started:** 2026-06-14
- Actions taken:
  - Reproduced a real retained-run defect from the TUI: queueing a completed run via `p` could flip the run to `running` while leaving stale completion metrics, progress, and artifacts visible.
  - Introduced an explicit `queued` run status in `src/state/types.ts`, updated `src/core/runner.ts` to return that status from `queue`, and taught `resume`/`replay` to restart from the queued state.
  - Updated `src/state/store.ts` so queueing archives prior active artifacts under `.history/queue-*`, clears the active run surface, and hides `.history` from default artifact browsing.
  - Verified replay from the queued TUI surface restarts from a clean active artifact set rather than reusing the previous execution artifacts.
  - Filtered transient atomic-write temp files like `state.json.tmp-*` out of `StateStore.listArtifacts()` after a live replay exposed them briefly in the TUI.
  - Extended regression coverage for queued-state behavior, archive hiding, queued-count rendering, and temp-file filtering.
- Verification:
  - `npm run build` → pass
  - `npm test` → pass, `88/88`
  - Live queue defect reproduction before the fix:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-queue.HMYcil/workdir`
    - after pressing `p`, the run showed `status: running` with stale `completed` timestamp and stale metrics/progress, which identified the defect
  - Live queue proof after the fix:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-queue-fix.Ub7xV1/workdir`
    - after pressing `p`, the surface rendered:
      - `runs=1 completed=0 failed=0 awaiting=0 queued=1`
      - `status: queued`
      - `Progress` → `phases: 0/6`, `tasks: -`
      - `Run Metrics` → `No metrics.json found.`
      - `Artifacts` → only `state.json`
  - Static queued snapshot:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-queue-fix.Ub7xV1/workdir --once`
    - rendered the same queued-state reset without stale metrics or artifacts
  - Live replay proof from queued state:
    - from the same queued TUI surface, pressing `l` reran the goal and returned to `completed`
    - the refreshed surface showed a new start time (`2026-06-14T21:11:44.857Z`), fresh execution events, and no transient `state.json.tmp-*` artifact after the temp-file filter landed
  - Static post-replay snapshot:
    - `node dist/index.js tui --config /Volumes/Storage/OpenMythos/openmythos.config.json --profile fake --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-queue-fix.Ub7xV1/workdir --once`
    - rendered a normal completed run surface with no temp artifacts in the list
- Files created/modified:
  - `src/state/types.ts`
  - `src/state/store.ts`
  - `src/core/runner.ts`
  - `src/ui/tui.ts`
  - `src/test/fake-run.test.ts`
  - `src/test/state.test.ts`
  - `src/test/tui.test.ts`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Session: 2026-06-14 (live TUI approval-state proof)

### Roadmap Comfort Gate Progress

- **Status:** complete for this slice
- **Started:** 2026-06-14
- Actions taken:
  - Re-ran the active product receipts before changing the plan record: `npm run cli -- readiness --workdir .`, `npm run build`, and `npm test`.
  - Verified the live `awaiting_approval` path with a real `session --tui` run using a temp workdir and approval-enforcing fake profile. Sent `a` from the TUI and confirmed the run resumed from `awaiting_approval` to `completed`.
  - Verified the live cancel path with a second real `session --tui` run in a separate temp workdir. Sent `c` from the TUI and confirmed the run ended in `failed` with `Cancelled from TUI.` on the selected-run surface and final JSON output.
  - Fixed retained-state drift in `src/core/runner.ts` by syncing `metrics.json` after `cancel`, `reject`, and `queue`, then extended `src/test/fake-run.test.ts` to assert failed metrics state after cancel/reject.
  - Fixed dashboard status drift in `src/ui/tui.ts` by deriving bench status counts from live run state instead of stale retained metrics, then added `renderDashboard uses live run state for bench status counts when retained metrics are stale` in `src/test/tui.test.ts`.
- Verification:
  - `npm run cli -- readiness --workdir .` → unchanged product gate summary:
    - `supportedCount: 5`
    - `partialCount: 1`
    - remaining missing evidence: `comparative.claude.coverage.missing`
  - `npm run build` → pass
  - `npm test` → pass, `85/85`
  - Live approval proof:
    - `node dist/index.js session "fake run requiring approval" --config /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-approval-fix.tChrXZ/config-fake-approval.json --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-approval-fix.tChrXZ/workdir --tui`
    - observed `awaiting_approval` in the TUI, sent `a`, and finished with final JSON `status: "completed"`
  - Live cancel proof:
    - `node dist/index.js session "fake run requiring approval" --config /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-cancel.ZqBAPV/config-fake-approval.json --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-cancel.ZqBAPV/workdir --tui`
    - observed `awaiting_approval` in the TUI, sent `c`, and finished with final JSON `status: "failed"`
  - Static dashboard proof:
    - `node dist/index.js tui --workdir /Volumes/Storage/omp-harness-storage/tmp/openmythos-tui-cancel.ZqBAPV/workdir --once`
    - rendered `runs=2 completed=0 failed=2 awaiting=0`
    - selected run showed `error: Cancelled from TUI.`
- Files created/modified:
  - `src/core/runner.ts`
  - `src/test/fake-run.test.ts`
  - `src/ui/tui.ts`
  - `src/test/tui.test.ts`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Session: 2026-06-14 (session-native progress surface)

### Roadmap Comfort Gate Progress

- **Status:** complete for this slice
- **Started:** 2026-06-14
- Actions taken:
  - Verified the live `session --tui` execution path after the `Runner.start()` change instead of trusting stale unit intent.
  - Added a first-class `Progress` section to the TUI fed by `state.json`, `plan.json`, `execution.json`, and the latest event.
  - Surfaced phase progress, planned/completed task counts, the latest worker/task receipt, and the latest execution event before or alongside final metrics.
  - Extended the dashboard regression test to require the new progress surface.
- Verification:
  - `npm run cli -- readiness --workdir .` → unchanged gate summary: `supportedCount: 5`, `partialCount: 1`, remaining missing evidence `comparative.claude.coverage.missing`
  - `npm run build` → pass
  - `npm test` → pass, `82/82`
  - `npm run cli -- session "fake run" --profile fake --workdir . --tui` → live runtime proof:
    - initial TUI frame showed the selected run as `running`
    - subsequent refresh showed the same run as `completed`
    - focused artifact preview showed `review-task-1.patch`
    - final JSON result reported `status: "completed"` with retained artifacts
  - `npm run cli -- tui --workdir . --once` after the build settled now renders:
    - `Progress`
    - `phases: 6/6`
    - `tasks: 1/1`
    - `latest task: task-1 model/coder success`
    - `latest event: [success] verify:verify`
- Files created/modified:
  - `src/ui/tui.ts`
  - `src/test/tui.test.ts`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Session: 2026-06-14 (tui diff-first comfort slice)

### Roadmap Comfort Gate Progress

- **Status:** complete for this slice
- **Started:** 2026-06-14
- Actions taken:
  - Added `StateStore.readArtifactText()` so the operator surface can preview retained artifacts directly instead of only listing names.
  - Reworked the TUI artifact surface in `src/ui/tui.ts` to:
    - sort artifacts by operator value
    - default focus to review/diff artifacts
    - show a bounded `Focused Artifact` preview block inline
    - support `[` / `]` artifact navigation without losing existing approve/reject/cancel/queue/replay controls
  - Hardened `summarizeBench()` in `src/core/metrics.ts` so older retained metrics missing newer counters are treated as zero rather than poisoning the bench summary with `NaN`.
  - Updated README shell/TUI guidance and readiness evidence wording to reflect the diff-first artifact preview surface.
- Verification:
  - `npm run build` → pass
  - `npm test` → pass, 81/81 tests
  - `npm run cli -- tui --workdir . --once` → rendered:
    - artifact-navigation keys in the header
    - `Focused Artifact`
    - inline patch preview for `review-task-1.patch`
    - non-`NaN` bench totals for task routes and verification counts
  - `npm run cli -- readiness --workdir .` → unchanged product gate summary:
    - `supportedCount: 5`
    - `partialCount: 1`
    - remaining missing evidence: `comparative.claude.coverage.missing`
- Files created/modified:
  - `src/state/store.ts`
  - `src/ui/tui.ts`
  - `src/core/metrics.ts`
  - `src/core/readiness.ts`
  - `src/test/tui.test.ts`
  - `src/test/metrics.test.ts`
  - `README.md`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Session: 2026-06-14 (comparative baseline hardening)

### Phase 5: Product Readiness Promotion Gate

- **Status:** in progress
- **Started:** 2026-06-14
- Actions taken:
  - Hardened `readiness` so partial comparative fixture coverage remains a `missing` condition instead of silently promoting outcome-superiority to `supported`.
  - Fixed `record-baseline` source discovery so it prefers the source root `summary.json` over nested fixture summaries.
  - Filtered comparative baseline and baseline-source summaries out of `liveEvalSummaries` so smoke-eval reporting only reflects actual eval-style runs.
  - Added a retained direct Codex comparative baseline source bundle under `runs/baseline-sources/codex-daily-workflow-suite-2026-06-14T20-32-58Z/` with:
    - copied fixture repos
    - git baselines
    - real code edits for `noop-js` and `trim-js`
    - `npm test` receipts
    - diff/stat and git-status artifacts
    - fixture-level and suite-level comparative summaries
  - Imported that bundle into `runs/comparative-baselines/codex/` through `record-baseline`.
  - Verified the fixed import path with a second import whose manifest now points at the root suite summary and retains both fixtures.
- Verification:
  - `npm run build && npm test` → pass, 78/78 tests
  - New test coverage:
    - `buildReadinessReport ignores comparative baseline summaries when collecting smoke evals`
    - `outcome-superiority stays partial when a provider baseline is present but fixture coverage is incomplete`
    - `record-baseline prefers the root summary.json over nested fixture summaries`
  - Runtime proof:
    - `node dist/index.js record-baseline codex runs/baseline-sources/codex-daily-workflow-suite-2026-06-14T20-32-58Z --workdir . --name direct-daily-workflow-suite-v2`
    - result reports `fixtureCoverage: ["noop-js", "trim-js"]` and `evidenceMode: "suite"`
  - `npm run cli -- readiness --workdir .` now reports:
    - `supportedCount: 5`
    - `partialCount: 1`
    - `missingEvidenceCount: 1`
    - remaining missing evidence: `comparative.claude.coverage.missing` for fixture `trim-js`
- Files created/modified:
  - `src/core/readiness.ts`
  - `src/ui/cli.ts`
  - `src/test/readiness.test.ts`
  - `src/test/record-baseline.test.ts`
  - `runs/baseline-sources/codex-daily-workflow-suite-2026-06-14T20-32-58Z/...`
  - `runs/comparative-baselines/codex/direct-daily-workflow-suite/...`
  - `runs/comparative-baselines/codex/direct-daily-workflow-suite-v2/...`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`

## Session: 2026-06-14 (config discovery and release gate)

### Phase 4 Closure / Phase 5 Progress

- **Status:** complete for Phase 4, in progress for Phase 5
- **Started:** 2026-06-14
- Actions taken:
  - Added shared config discovery in `src/config/discovery.ts` so the default `openmythos.config.json` is found by walking up from `--workdir` first, then the shell cwd.
  - Updated CLI runtime and real-eval entrypoints to use shared config discovery and emit searched-path context on config failures.
  - Updated `runSetupCheck` to report `configSearchPaths` and `configSource` in machine-readable output.
  - Added `openmythos.config.example.json` so setup now points to a real template file.
  - Added README onboarding guidance for config creation and upward config discovery.
  - Added an explicit pre-tag release gate sequence to README covering `check`, `readiness`, `real-benchmark`, `record-baseline`, and `release-check`.
  - Reconciled the task plan: Phase 4 is now complete; Phase 5 remains blocked only on real comparative baseline artifacts.
- Verification:
  - `npm run build && npm test` → pass, 75/75 tests
  - New tests:
    - `discoverConfigPath walks workdir ancestors for the default config filename`
    - `CLI run discovers config from a workdir ancestor when launched outside the repo`
  - Live CLI proof:
    - From `/`, `node /Volumes/Storage/OpenMythos/dist/index.js setup --workdir /Volumes/Storage/OpenMythos/src --profile fake --json`
    - Result resolved `configPath` to `/Volumes/Storage/OpenMythos/openmythos.config.json`
    - Reported `configSource: "workdir-ancestor"` and the searched config path list instead of failing on `/openmythos.config.json`
  - `npm run cli -- readiness --workdir .` now reports:
    - `supportedCount: 5`
    - `partialCount: 1`
    - remaining partial goal: `outcome-superiority`
- Files created/modified:
  - `src/config/discovery.ts`
  - `src/core/setup.ts`
  - `src/ui/cli.ts`
  - `src/test/config-discovery.test.ts`
  - `openmythos.config.example.json`
  - `README.md`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`

## Session: 2026-06-14 (continued)

### Phase 4: Expand Real Worker Actions

### Phase 4 Completion (2026-06-14 18:41 UTC)

- **Status:** complete
- **Key finding:** All 8 task-loop action families already wired in `phases.ts` with real implementations (confirmed via code inspection, not assumption). Previous claim in findings.md was stale.
- **Verification:**
  - `npm test`: 71/71 pass (0 failures)
  - `npm run build`: clean
  - `real-eval.test.ts` + `tooling.test.ts`: 9/9 pass (exercises shell, verification commands against real fixture repos)
  - `npm run cli -- tui --workdir . --once`: renders correctly, all hotkeys present
- **Evidence:**
  - Tool catalog in `tooling.ts:23-119` defines all 8 action families
  - Phase executor in `phases.ts:952-983` dispatches all 8 with real implementations
  - Risk gating in `phases.ts:1042-1093` covers destructive/git-write/non-GET-API
  - `schemas.ts:210-217` validates all tool IDs in the task tool contract
  - `readiness.ts:198` enforces the 8-tool expectation

### Phase 5 Blockers (2026-06-14 18:41 UTC)

- **Real benchmark suite:** BLOCKED — `zai-live-gate` profile times out (needs live Z.AI API endpoint)
- **Comparative baselines:** BLOCKED — requires real Claude Code and Codex runs on fixtures
- **TUI:** verified hotkeys present (approve/reject/cancel/queue/replay)

- **Status:** in progress
- **Started:** 2026-06-14
- Actions taken:
  - Added model-tool risk assessment in `src/core/phases.ts` for shell, package, git, and API tool requests.
  - Added explicit enforce/suggest policy paths for high-risk tool calls with durable tool-approval artifacts.
  - Added `ToolApprovalRequiredError` handling in `src/core/runner.ts` and wired a `tool_approval_required` execution event.
  - Fixed model-tool approval branch wiring in `src/adapters/fake.ts` (`model tool approvals` goal).
  - Added deterministic fake regression test `Runner can stop before high-risk model tool operations` to prove no output write occurs before approval.
  - Ran `npm run build` and `npm test` successfully after changes.
- Files created/modified:
  - `src/core/phases.ts`
  - `src/core/runner.ts`
  - `src/core/review.ts`
  - `src/adapters/fake.ts`
  - `src/test/fake-run.test.ts`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Session: 2026-06-14

### Phase 4: Expand Real Worker Actions

- **Status:** in progress
- **Started:** 2026-06-14
- Actions taken:
  - Added `branch`, `stage`, `commit`, `rollback`, `publish-pr`, and `release-check` CLI commands for repo lifecycle operations.
  - Updated readiness to detect repo-lifecycle command presence and report it as real product evidence only when all required commands are present.
  - Hardened `outcome-superiority` evidence classification so comparative baseline artifacts are real evidence and missing baseline paths remain explicit missing evidence.
  - Added readiness regression tests for repo lifecycle command coverage and comparative-baseline evidence assertions.
  - Ran full TypeScript build and full test suite; all tests pass after changes.
- Files created/modified:
  - `src/core/readiness.ts`
  - `src/ui/cli.ts`
  - `src/test/readiness.test.ts`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`


### Phase 1: Evidence Inventory And Classification

- **Status:** complete
- **Started:** 2026-06-14
- Actions taken:
  - Confirmed the repo had no existing `.planning` directory.
  - Read the planning-with-files templates.
  - Re-read the active roadmap to align the plan with the full product goal.
  - Created an active planning record for real evidence recovery.
  - Classified fake tests and fake profiles as regression-only evidence.
  - Wrote next-worker instructions for replacing fake confidence with real tests and retained artifacts.
- Files created/modified:
  - `.planning/.active_plan`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/findings.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

### Phase 2: Real Benchmark Harness

- **Status:** complete
- Actions taken:
  - Added a schema-driven real benchmark suite manifest and command path under `fixtures/real-eval`.
  - Added a second benchmark fixture (`trim-js`) and suite orchestrator (`daily-workflow-suite`) requiring real repository edits.
  - Added suite-mode real-eval execution via `real-benchmark` with retained suite-level scoring receipts.
  - Enforced a non-fake profile requirement in the real benchmark path and preserved artifact-level scoring in receipts.
- Files created/modified:
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`
  - `src/core/real-eval.ts`
  - `src/test/readiness.test.ts`
  - `src/test/real-eval.test.ts`
  - `src/ui/cli.ts`
  - `README.md`
  - `fixtures/real-eval/noop-js/...`
  - `fixtures/real-eval/trim-js/...`
  - `fixtures/real-eval/suites/daily-workflow-suite.json`

### Phase 3: Replace Narrow Live Gates

- **Status:** complete
- **Started:** 2026-06-14
- Actions taken:
  - Added smoke-mode metadata to `eval` summary artifacts and made `live-eval` the explicit real repository command.
  - Kept `real-eval` as a compatibility alias to `live-eval`.
  - Extended real-eval round receipts with run directory, run artifacts, diff-stat, model bindings, and endpoint-bound model metadata.
  - Updated readiness classification so marker/smoke summaries do not contribute real-outcome evidence.
  - Added README command examples to separate smoke checks from real evidence commands.
- Files created/modified:
  - `src/ui/cli.ts`
  - `src/core/readiness.ts`
  - `src/test/readiness.test.ts`
  - `README.md`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

### Readiness Evidence Hardening

- **Status:** complete
- Added: `src/test/readiness.test.ts`
- Evidence: explicit shape guard now prevents raw `LiveEvalSummary` objects from entering `outcome-superiority.realEvidence` in tests.

### Phase 4: Expand Real Worker Actions

- **Status:** in progress
- **Started:** 2026-06-14
- Actions taken:
  - Added a dedicated onboarding/setup check command with first-run validation for config, profile overlay, workspace, and API key presence.
  - Added a `session` command that executes repo goals from a daily-driver entrypoint and optionally hands off to TUI.
  - Updated readiness to treat onboarding and session entrypoints as real evidence when present.
  - Added readiness coverage for setup/session command presence.
- Files created/modified:
  - `src/core/setup.ts`
  - `src/core/readiness.ts`
  - `src/ui/cli.ts`
  - `src/test/readiness.test.ts`
  - `README.md`
  - `.planning/2026-06-14-real-evidence-recovery/task_plan.md`
  - `.planning/2026-06-14-real-evidence-recovery/progress.md`

## Test Results

| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Git status before planning | `git status --short --branch` | Clean branch against origin | `## main...origin/main` | pass |
| Planning directory discovery | `find .planning -maxdepth 3 -type f -print` | Existing plan files or no directory | No `.planning` directory existed | pass |
| Readiness audit after planning | `npm run cli -- readiness --workdir .` | Conservative failure until real/comparative evidence exists | Exit code 1; 6 product goals, 0 supported, 6 partial, 1 fake evidence item, 9 real evidence items, 8 missing evidence items | pass |

## Error Log

| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-06-14 | No persistent planning state existed for this recovery work. | 1 | Created `.planning/.active_plan` and a dated plan directory. |

## 5-Question Reboot Check

| Question | Answer |
|----------|--------|
| Where am I? | Phase 4 (Expand Real Worker Actions) is in progress and now includes policy-gated model-tool risk enforcement + regression proof of enforcement behavior. |
| Where am I going? | Finish full 2027 default-harness capability: shell/package/git/browser/api/db execution loops with retained evidence, comparative superiority baselines, and TUI comfort-level workflow parity. |
| What's the goal? | A Claude Code or Codex user can adopt OpenMythos as a default harness without losing workflow comfort, with retained evidence and improved verified outcomes on real tasks. |
| What have I learned? | Fake tests remain useful for deterministic invariants only; harness policy gates must have direct, side-effect-safe real-enough tests before claiming user-facing capability. |
| What have I done? | Added enforce-mode tool-approval gating for high-risk model tool actions, plus tests and documentation updates to prevent fake-confidence drift from resuming work. |
