# Next-Worker Runbook: OpenMythos Default-Harness Recovery (Deterministic)

Use this exact sequence for the next model run (GLM-5.1 or GLM-5.2):

1. Bootstrapping check
- run `npm test`
- run `npm run build`
- run `npm run cli -- readiness --workdir .`
- capture outputs and fail only for status != 0 only if evidence is still missing from required goals.

2. Real evidence gap closure (Phase 5)
- run retained real suite: `npm run cli -- real-benchmark --profile zai-live-gate --suite daily-workflow-suite --workdir runs/real-evals`
- verify generated `runs/real-evals/` artifacts include:
  - `summary.json` with `evidenceLevel = "real"`
  - fixture diffs and command outputs for the required file changes
  - per-suite `runId`, `outcome`, and model/profile metadata

3. Comparative baseline requirement (Phase 5)
- create `runs/comparative-baselines/claude-code/` and `/codex/` with real benchmark artifacts for the same fixtures:
  - command used
  - duration/turn count
  - changed files and diff summary
  - completion status + failure reasons
  - evidence timestamp
- keep at least one retained artifact per benchmark task per baseline tool.

4. Readiness promotion
- rerun `npm run cli -- readiness --workdir .`
- confirm `productGoals.outcome-superiority` has no `missingEvidence` entries.

5. TUI confidence checks
- run `npm run tui -- --workdir .` in a test session
- validate workflow hotkeys for approve/reject/cancel/queue/replay and resume flow are present.

6. Commit readiness for continuation
- only commit when a new piece of evidence reduces one `missingEvidence` item.
- do not add fake fixtures/artifacts as evidence.

7. Reporting
- append the exact test outputs and readiness summary to `.planning/2026-06-14-real-evidence-recovery/findings.md`.

### Execution model
- primary: `glm-5.1` (until independent 5.2 verification)
- alternate: `glm-5.2` only for comparison lanes and high-stakes planning runs
- thinking: `{"type": "enabled"}`
- stream: `false`
