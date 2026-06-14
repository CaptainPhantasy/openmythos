![OpenMythos social preview](assets/openmythos-social.png)

# OpenMythos

OpenMythos is a deterministic multi-model orchestration harness for agentic
software work. The core rule is simple: code owns the loop. Models classify,
compress, plan, implement, critique, and verify as replaceable workers, but the
harness owns phase transitions, state, validation, retries, local checks, and
the audit trail.

The project was built after a live Z.AI/GLM coding-endpoint gate: 15 consecutive
real API harness rounds completed under the configured GLM-5.1 10 RPM profile.
That gate is intentionally small and repeatable, because it tests the harness
contract instead of hiding orchestration flaws behind a large coding task.

## Why This Exists

Most agent failures come from giving the model ownership of too much process:
phase drift, malformed JSON, hidden state, infinite retries, and unverifiable
"done" claims. OpenMythos treats the model as a powerful worker behind a strict
contract. The runner decides what phase comes next, persists every artifact to
disk, validates model output through schemas, and stops when retry limits are
exhausted.

## Features

- Deterministic phase loop: intake -> context -> plan -> execute -> verify.
- Query-aware context retrieval with scored file selection and targeted snippets.
- Dependency-aware execution batches for independent task fan-out.
- Filesystem-backed run state under each workspace's `runs/` directory.
- Schema validation for every model response.
- Bounded JSON repair retry with raw invalid-response artifacts.
- Patch-safe file edits plus review artifacts before apply.
- Approval policy for risky file actions before apply.
- Governance preflight for git-required mode, dirty-worktree policy, and protected branches.
- Local verification commands before model QA, plus per-task verification commands
  retained as execution receipts.
- Structured `review` command for local git diffs with machine-readable findings.
- Issue ingestion from local files and GitHub issue references.
- Pull-request ingestion from local files and GitHub pull requests, with external
  check summaries retained as run artifacts.
- Adapter profiles for fake, Z.AI GLM coding, and frontier model experiments.
- Retained `metrics.json` artifacts and benchmark aggregation with `bench`.
- Consecutive-round eval command for proving harness stability.
- Product-readiness evidence audit with `readiness`, separating real evidence
  from fake regression coverage and missing product proof.
- Structured tool and harness observations with status, next actions, and
  artifact references for recovery-aware execution receipts.
- Terminal-native dashboard for inspecting run state, metrics, artifacts, and event logs.

## Installation

```bash
npm install
npm run build
```

OpenMythos requires Node.js 20 or newer.

## Configuration

Copy the example environment file and add your keys locally:

```bash
cp .env.example .env
```

For Z.AI coding-plan usage, the relevant variables are:

```bash
ZAI_API_KEY=...
ZAI_CODING_BASE_URL=https://api.z.ai/api/coding/paas/v4
ZAI_GENERAL_BASE_URL=https://api.z.ai/api/paas/v4
```

`.env` is ignored by Git. Do not commit API keys.

Model rosters live in `openmythos.config.json` and profile overlays live in
`profiles/`.

## Usage

Run a goal:

```bash
node dist/index.js run "your goal"
```

From source (no build-time binary needed):

```bash
npm run dev -- run "your goal"
```

Or if you've already built once in this checkout:

```bash
npm run cli -- run "your goal"
```

To keep `openmythos` available from the shell, install it once globally from this repo:

```bash
npm link
openmythos tui
```

If you prefer not to link globally, use:

```bash
npm exec openmythos tui
```

Run with a profile:

```bash
node dist/index.js run --profile zai-live-gate "your goal"
node dist/index.js run --profile glm-5.2-frontier "your goal"
```

## Project Port Registry (local)

This repository keeps a local port registry under `.supercache/ports` to avoid
reusing occupied or forbidden ports.

- Forbidden runtime ports: `3000`, `5173`
- Default claimed runtime ports for the VOID UI:
  - `npm run void:server` → port `4174`
  - `npm run void:ui` → port `4175`

Before starting a new local service, claim its port:

```bash
npm run claim:port -- 4174
npm run claim:port -- 4175
```

Run the smoke marker eval (no repository proof, adapter connectivity only):

```bash
node dist/index.js eval --profile fake --rounds 10
```

Run a smoke Z.AI marker check (for endpoint health only):

```bash
node dist/index.js eval \
  --profile zai-live-gate \
  --rounds 15 \
  --workdir runs/live-evals \
  --goal "Create exactly one file named openmythos-live-output.txt whose complete content is OPENMYTHOS_LIVE_SUCCESS followed by a newline. Do not modify any other files."
```

Run the retained real repository eval (real evidence):

```bash
node dist/index.js live-eval \
  --profile zai-live-gate \
  --fixture noop-js \
  --workdir runs/real-evals
```

`real-eval` remains as an alias for `live-eval`.

Run the retained real benchmark suite:

```bash
node dist/index.js real-benchmark \
  --profile zai-live-gate \
  --suite daily-workflow-suite \
  --workdir runs/real-evals
```

`real-eval` refuses fake profiles. It copies a retained fixture repository,
initializes git history, runs the harness against a real bug-fix task, and then
proves the result with repository-local verification commands plus expected-file
and prohibited-artifact checks.

Inspect runs:

```bash
node dist/index.js list
node dist/index.js status <run-id>
node dist/index.js inspect <run-id>
node dist/index.js resume <run-id>
node dist/index.js tui
node dist/index.js tui --workdir <project-or-round-workdir> --once
```

Benchmark retained metrics:

```bash
node dist/index.js bench --workdir .
node dist/index.js bench --workdir runs/evals
```

Audit product-readiness evidence:

```bash
node dist/index.js readiness --workdir .
```

`readiness` is intentionally stricter than `test` or `eval`. It reports which
2027 product goals have real functional evidence, which are backed only by fake
regression coverage, and which still lack proof. It exits non-zero while any
product goal has missing evidence.

Review local changes:

```bash
node dist/index.js review
node dist/index.js review --cached
node dist/index.js review --base origin/main --head HEAD
```

Resolve or run from an issue:

```bash
node dist/index.js issue docs/issues/example.md
node dist/index.js issue owner/repo#42
node dist/index.js run-issue docs/issues/example.md
node dist/index.js run-issue https://github.com/owner/repo/issues/42
```

Resolve, verify, or run from a pull request:

```bash
node dist/index.js pr docs/pulls/example.md
node dist/index.js pr owner/repo#17
node dist/index.js verify-pr https://github.com/owner/repo/pull/17
node dist/index.js run-pr docs/pulls/example.md
```

Approval policy:

- `approval.mode = "suggest"` writes per-task review artifacts without blocking.
- `approval.mode = "enforce"` stops the run with `awaiting_approval` when a task
  proposes high-risk edits such as deletes, protected-path writes, or
  credential-like file changes.
- secret-like content in proposed edits is treated as high risk and enters the
  same review/approval path.
- Review artifacts are written into each run directory as `review-<task>.json`
  and `review-<task>.patch`.

Governance policy:

- `governance.requireGitRepo` can require repository-backed runs.
- `governance.dirtyWorktree` controls how the harness handles a dirty tree:
  `allow`, `warn`, or `block`.
- `governance.protectedBranchMode` applies the same policy to protected branch
  matches from `governance.protectedBranches`.
- governance preflight runs before model phases and writes a `governance.json`
  artifact into the run directory.

## Runtime Artifacts

Each run writes an inspectable artifact set:

- `state.json`: phase, status, retry count, timestamps, final output.
- `events.jsonl`: append-only event ledger.
- `intake.json`: task classification and success criteria.
- `context.json`: selected file manifest and compressed context.
- `plan.json`: schema-validated execution plan.
- `outputs.json`: schema-validated worker outputs and file edits.
- `execution.json`: deterministic task execution receipts, including
  `executor`, `harnessAction`, required tools, structured observations,
  task-level verification commands, command results, and next actions.
- structured observations now carry `status`, `summary`, `nextActions`, and
  `artifacts` so every tool or harness result can drive an explicit recovery
  step instead of only dumping raw content.
- `task-context-*.json`: structured task-scoped retrieval evidence captured
  for model-executed tasks that request deterministic search or symbol context.
- `task-dependencies-*.json`: dependency-scoped handoff payloads retained for
  downstream model tasks, including only declared upstream outputs and receipts.
- `task-snippets-*.json`: per-task repository snippet packs retained for model
  tasks so execution context can be inspected separately from the broader run
  context.
- `task-tool-turns-*.json`: bounded model-tool loop history for tasks that
  requested additional harness evidence before producing a final result.
- `task-observation-*.json`: structured read-only evidence captured by
  harness-executed verifier tasks.
- `qa.json`: local and model verification result.
- `issue.json`: canonical issue payload when a run was started from an issue
  source.
- `pull-request.json`: canonical pull-request payload when a run was started
  from a pull-request source.
- `pr-verification.json`: summarized external verification evidence for a
  GitHub-backed pull request, including check status and failing checks.
- `governance.json`: repository preflight result, including dirty-tree and
  branch-policy findings.
- `metrics.json`: retained run metrics, including model calls, token totals,
  durations, edit counts, verification counts, and model tool-loop counts.
- `final.md`: final execution report.
- `*-invalid-attempt-*.txt`: raw invalid model responses saved during bounded
  JSON repair.

Local review writes artifact pairs under `reviews/` by default:

- `review-*.json`: structured review input and findings.
- `review-*.md`: human-readable review report.

Plan task contract:

- planners can now specify `requiredTools`, `executor`, `harnessAction`, and
  `executionMode`
- planners can specify `contextQueries` to request deterministic task-scoped
  retrieval during execution
- planners can specify `verificationCommands` for task-level local evidence
- model-executed tasks can request bounded read-only tool turns, and the
  harness enforces `execution.maxTaskToolTurns` as a hard stop condition
- model-executed tasks can request `verification.command` during bounded tool
  turns, but only for exact commands already declared in the task's
  `verificationCommands` allowlist
- `requiredTools` are normalized against a deterministic harness catalog and
  repaired or rejected when they reference unsupported or role-mismatched tools
- model-executed tasks can now request deterministic repository search and
  symbol lookup, and the harness retains the resulting task context as
  structured observations and artifacts
- model-executed tasks can request additional read/search/diff evidence during
  execution, and the harness records the resulting tool turns and tool-call
  counts in receipts and retained metrics
- dependent model tasks now receive only their declared upstream outputs and
  execution receipts, instead of the full prior-output history from unrelated
  tasks
- model tasks now receive repository snippets scoped to their own file targets,
  context queries, and declared dependency artifacts instead of the full
  compressed snippet pack for the run
- planners can set `executor = "harness"` for read-only verifier work so the
  harness can execute deterministic verification tasks without a model call
- harness-executed verifier tasks must declare a typed `harnessAction`, and the
  harness now rejects tool/action mismatches before execution
- harness-executed verifier tasks retain structured observations matched to the
  selected action family, such as file-state reads, git state, diffs, and
  workflow artifact context for later QA and audit
- task roles are now routed through matching worker lanes, including
  task-level `verifier` execution before the final QA gate
- the harness can batch dependency-free tasks when they are marked
  `executionMode = "parallel"` and do not target the same files

Current supported `requiredTools` ids:

- `filesystem.read`
- `filesystem.search`
- `code.symbols`
- `filesystem.write`
- `filesystem.patch`
- `shell.run`
- `verification.command`
- `review.inspect`
- `git.status`
- `git.diff`
- `git.issue_view`
- `git.pr_view`

Current supported `harnessAction` ids:

- `verify.file_state`
- `verify.git_status`
- `verify.git_diff`
- `verify.issue_context`
- `verify.pr_context`
- `verify.pr_checks`

## Z.AI / GLM Notes

OpenMythos includes first-class Z.AI-compatible configuration because the GLM
coding models are practical worker engines for this style of harness. The
default live profile uses `glm-5.1` on the Z.AI coding endpoint with a shared
10 RPM model bucket. A GLM-5.2 profile is included for controlled frontier
testing after independent validation.

A nod to the Z.AI and GLM teams: the openness and availability of GLM coding
models make it possible to build and test this kind of model-agnostic harness
without tying the architecture to a single closed vendor UI.

See `docs/ZAI_GLM_USER_INFO.md` for the local model-usage guide.

## Development

```bash
npm run check
```

`npm run check` builds TypeScript and runs the Node test suite.

## License

MIT. See `LICENSE`.
