# OpenMythos 2027 Default Harness Roadmap

## Purpose

This document defines the real adoption bar for OpenMythos.

The question is not whether OpenMythos is an interesting orchestrator. The
question is whether a developer who is already comfortable in Claude Code or
Codex can switch to OpenMythos, use it as the default harness for daily repo
work, feel good about the UI and control surface, and get a better outcome than
they would have received from using Claude Code or Codex directly.

That is a much higher bar than "more features" or "stronger planning."

## Current Baseline

OpenMythos already has a serious harness core:

- code owns the main loop: `intake -> context -> plan -> execute -> verify`
- run state and artifacts persist under `runs/`
- model output is schema-validated and retried on malformed JSON
- patch-safe edits, review artifacts, and approval gating exist
- governance preflight exists for dirty trees, protected branches, and
  repository requirements
- issue and PR ingestion exist
- benchmark aggregation and replayable eval rounds exist
- dependency-aware batching, bounded model tool turns, and task-scoped snippet
  context exist
- a terminal dashboard exists for run metrics, artifacts, and events

This is a credible harness foundation. It is not yet a comfortable default
daily coding harness.

## The Goal That Must Be Set

The correct goal is:

**A Claude Code or Codex user can move into OpenMythos without losing expected
daily coding capability, without fighting the UI or workflow, and with measured
improvement in verified outcomes.**

That breaks into three gates.

### 1. Parity Gate

A user must be able to do normal repo work in OpenMythos without dropping back
to Claude Code or Codex for routine actions.

Required parity:

- point the harness at a repository and get precise retrieval
- execute repo work from a goal, issue, or PR
- inspect and approve proposed edits safely
- run shell, git, test, and verification actions in the normal task loop
- review diffs and findings inside the harness workflow
- resume, replay, and benchmark runs without manual artifact archaeology

### 2. Comfort Gate

A user must feel comfortable operating the harness as a daily tool, not merely
able to force work through it.

Required comfort:

- terminal-native controls for queue, cancel, retry, approve, reject, and replay
- diff-first views instead of JSON-first inspection
- clear run progress, task progress, and active worker state
- obvious recovery actions when a run fails or pauses
- minimal setup friction for profiles, keys, and workspace binding
- predictable commands and discoverable workflow entrypoints

### 3. Superiority Gate

OpenMythos must beat direct Claude Code or Codex usage in ways that matter.

Required superiority:

- higher verified completion rate on real repo tasks
- lower unverified or unsafe edit escape rate
- stronger governance and approval discipline
- better retained evidence and replayability
- better multi-step task decomposition on larger repo work

If those advantages are not measurable, then OpenMythos is still an internal
harness project, not yet a default external working surface.

## Current Shortfalls Against That Goal

### 1. The Interaction Model Is Still Run-Centric, Not Session-Centric

The CLI surface is credible, but it still behaves more like a run engine than a
daily coding shell. Today the primary commands are `run`, `resume`,
`run-issue`, `run-pr`, `review`, `bench`, `status`, `inspect`, `list`, and
`tui`.

What is still missing for comfort:

- an execution-native interactive session loop
- inline approvals and edit decisions without leaving the main flow
- cancellation, queueing, and background run management
- task-level rerun and selective replay controls
- a single obvious "work this repo" or "take over this issue/PR" daily-driver entrypoint

Implication:
the current flow is powerful, but it still feels like operating a harness by
commands and artifacts rather than living inside it as a daily coding surface.

### 2. The TUI Is Still Inspection-First

The TUI exposes run lists, metrics, recent events, and artifact names. Its key
surface is still `j/down`, `k/up`, `r refresh`, `q quit`.

What is still missing for comfort:

- accept/reject approval actions
- diff preview inside the TUI
- artifact open/drill-down behavior
- queue and cancellation control
- task retry or phase replay from the dashboard
- side-by-side comparison between competing worker outputs

Implication:
the operator surface is informative, but not yet strong enough to replace the
developer's main terminal harness.

### 3. Worker Tooling Is Still Narrower Than Daily Expectations

OpenMythos now supports structured retrieval and bounded task tool turns, but
the actual task tool loop is still narrow. In the current task contract,
worker-requestable tools are limited to:

- `filesystem.read`
- `filesystem.search`
- `code.symbols`
- `git.status`
- `git.diff`
- `verification.command`

What is still missing for daily-driver parity:

- package-manager actions
- shell execution as a real worker tool in the bounded loop
- browser and UI verification tools
- API/database interaction tools
- git write actions such as branch creation, staging control, commit prep, and
  PR writeback

Implication:
the planner can decompose more intelligently than before, but the task loop
still lacks several action families that Claude Code and Codex users already
expect in daily repo work.

### 4. Execution Decomposition Is Better, But Not Yet Broad Enough

OpenMythos can batch independent tasks, scope dependency handoffs, and route
read-only verifier work to the harness. That is real progress.

What is still missing:

- richer worker families beyond `coder`, `critic`, and `verifier`
- planner-directed model routing by difficulty, latency, or cost
- long-running background jobs with intermediate progress
- explicit sub-agent orchestration for larger tasks
- write-capable harness-native execution families beyond verifier-style actions

Implication:
the execution graph is more disciplined than a simple linear pipeline, but it
still does not feel like a fully developed multi-worker coding system.

### 5. Verification Is Structurally Stronger, But Not Yet Broad Enough

OpenMythos already does better than many raw model loops because it persists
task receipts, review bundles, governance findings, verification commands, and
QA artifacts.

What is still missing for daily trust:

- first-class verification presets by task type
- built-in lint/build/test policy bundles
- browser/UI verification
- API contract validation
- security, dependency, and secret scanning beyond edit-risk detection
- performance and resource guardrails

Implication:
the harness can prove more than a chat-only coding tool, but it still does not
cover enough verification ground to become the obvious daily default.

### 6. Git and Review Workflow Stop Short of a Full Daily Repo Assistant

The harness can ingest issues and PRs, review local diffs, summarize external PR
checks, and retain evidence.

What is still missing:

- branch creation and workspace isolation by default
- stage/unstage control
- commit authoring workflow inside the harness
- PR comment or review publishing
- merge/rebase/cherry-pick aware flows
- rollback checkpoints for autonomous repo work

Implication:
OpenMythos participates in engineering workflow context, but it does not yet
own enough of the repo lifecycle to replace a developer's normal harness.

### 7. Outcome Superiority Is Still Unproven

This is the most important gap.

OpenMythos has replayable evals and retained metrics, but the evidence surface
is still mostly:

- fake-profile regression tests
- narrow live gates
- per-slice smoke proofs

What is still missing:

- a maintained benchmark suite of real repo tasks
- side-by-side baseline results versus direct Claude Code and Codex usage
- tracked verified completion, rework rate, unsafe edit rate, and time to
  verified completion
- promotion gates that block claims of superiority until those numbers hold

Implication:
the harness has internal proof of discipline, but it does not yet have external
proof of better outcomes.

### 8. User Comfort and Onboarding Are Not Yet First-Class Features

A default harness must be easy to start using, not only powerful once fully
configured.

What is still missing:

- first-run onboarding for profiles and keys
- clearer "recommended defaults" for real usage
- friendlier explanations of why the harness chose a task, tool, or worker
- simpler migration path for someone coming from Claude Code or Codex habits
- a polished story for shell availability such as `npm link`, `npm exec`, or
  repo-local invocation

Implication:
the current harness rewards a technical operator who already understands it; it
does not yet welcome a daily driver who wants immediate confidence.

## Full Product Goal Set

These are not MVP milestones, beta checkpoints, or partial stopping points.
Each item below describes a product-complete goal state that OpenMythos must
fully satisfy before it should claim default-harness readiness.

### Product Goal 1: OpenMythos Is A Complete Daily Work Surface

Goal state:

OpenMythos is the place where a developer starts, controls, pauses, resumes,
approves, rejects, retries, and reviews daily repository work. The harness does
not merely expose runs; it serves as the normal operating surface for them.

A complete implementation means:

- one obvious daily-driver entrypoint for repository work
- interactive session behavior instead of run-file archaeology
- terminal-native approval, cancellation, replay, retry, and queue control
- diff-first and artifact-aware views rather than JSON-first inspection
- clear worker, task, and run progress while work is active
- predictable recovery actions when a run fails or pauses

Completion criteria:

- a Claude Code or Codex user can operate routine repository work from the
  OpenMythos surface without feeling pushed back into raw artifact files or
  external harnesses

### Product Goal 2: OpenMythos Has A Complete Execution Fabric

Goal state:

OpenMythos can route real software work through the right workers and tools
without collapsing most tasks into one generic model-edit loop.

A complete implementation means:

- worker families richer than `coder`, `critic`, and `verifier`
- model routing policies by task type, latency, cost, and risk
- task execution that supports shell, package manager, git, browser, API, and
  database actions as first-class capabilities where appropriate
- deterministic harness-native execution families for operations that should not
  depend on model freeform behavior
- long-running background work with progress checkpoints
- safe multi-worker decomposition for larger tasks

Completion criteria:

- larger repository tasks can be decomposed and executed through appropriate
  worker lanes and tool families with no obvious "missing action surface"
  compared to daily Claude Code or Codex usage

### Product Goal 3: OpenMythos Is A Complete Verification And Safety System

Goal state:

OpenMythos does not merely propose changes and run a few commands. It verifies,
gates, and contains software changes at a level where a developer trusts it
with daily repository work.

A complete implementation means:

- verification presets by task class
- first-class lint, build, test, browser, contract, and policy verification
- security, dependency, secret, and performance guardrails
- branch/worktree-safe execution and rollback-aware recovery
- approval policies by risk category
- evidence-backed completion receipts that are stronger than model judgment

Completion criteria:

- high-risk work cannot pass on plausibility alone, and the harness provides a
  stronger safety and verification story than direct Claude Code or Codex use

### Product Goal 4: OpenMythos Owns The Full Repo Workflow

Goal state:

OpenMythos feels native inside engineering workflow from intake through review,
not adjacent to it.

A complete implementation means:

- issue and PR intake that converge into the normal execution path
- branch creation, staging, commit preparation, and rollback workflow support
- review preparation and publication paths
- durable repository memory and project notes
- run comparison, benchmark history, and workflow traceability
- repository isolation strong enough for autonomous work

Completion criteria:

- OpenMythos can own the normal repository loop from issue or PR context through
  verified change and review-ready output

### Product Goal 5: OpenMythos Is Comfortable To Adopt

Goal state:

OpenMythos is not only powerful after deep setup. It is understandable, easy to
start, and migration-friendly for a developer already used to Claude Code or
Codex.

A complete implementation means:

- first-run onboarding for profiles, keys, and workspace binding
- clear recommended defaults for real usage
- good explanations of why the harness chose a worker, tool, or action path
- a clean shell-install and invocation story
- discoverable workflow entrypoints that match daily coding habits

Completion criteria:

- a new user can adopt OpenMythos as a daily repo harness without needing deep
  internal knowledge of the project to feel in control

### Product Goal 6: OpenMythos Proves Better Outcomes Than Baseline Harnesses

Goal state:

OpenMythos can prove, not merely claim, that it delivers better verified
outcomes than direct Claude Code or Codex use on the class of work it targets.

A complete implementation means:

- a maintained benchmark suite of real repository tasks
- direct Claude Code and Codex baselines on those tasks
- tracked verified completion rate, unsafe edit escape rate, rework rate, and
  time to verified completion
- promotion gates for harness releases and model profiles
- replayable benchmark evidence retained with the results

Completion criteria:

- OpenMythos can demonstrate a measurable advantage over direct Claude Code and
  Codex use on real repository tasks, not just richer local instrumentation

## Evidence Hierarchy

Fake tests and fake profiles are allowed only as regression coverage for harness
invariants. They can prove that schemas, retries, receipts, and control-flow
boundaries still behave deterministically. They cannot prove product readiness,
daily-driver comfort, or superiority over Claude Code and Codex.

Evidence levels:

- `fake`: deterministic regression scaffolding such as `FakeAdapter`,
  `profiles/fake.json`, and fake-run tests
- `real`: functional local code paths, live non-fake retained runs, or real
  repository workflow evidence
- `comparative`: retained benchmark evidence against direct Claude Code and
  Codex baselines

The project now has a `readiness` command that audits those evidence levels
against this roadmap:

```bash
node dist/index.js readiness --workdir .
```

The command must remain conservative. If a product goal is supported only by
fake evidence or narrow live marker-file gates, it must report the gap instead
of treating the goal as complete.

## Completion Evidence Required

OpenMythos should not be called the default 2027 harness until the repo can
show all of the following:

- a feature matrix proving daily-driver parity for repo work
- an execution-native terminal surface with real control actions, not only
  inspection
- real-task benchmark results against direct Claude Code and Codex baselines
- measurable superiority in verified outcomes, not just richer artifacts
- repo-safe workflow coverage from intake through review preparation
- clear onboarding and default configuration paths for real users

## Final Goal

The final goal is this:

**OpenMythos becomes a terminal-native daily coding harness that a Claude Code
or Codex user can adopt as their default repo workflow in 2027 without losing
expected capability or comfort, and with a measured improvement in verified
outcomes.**

That means a developer can point it at a repository and expect it to:

- understand the repo with precise retrieval instead of brute-force context
- plan and decompose work into the right workers, tools, and safety lanes
- edit code with patch-safe, reviewable, repo-safe actions
- verify changes with strong local, external, and risk-aware evidence
- respect governance, secrets, branch safety, and risky-action approvals
- operate from a fast terminal-native surface that is comfortable for daily use
- integrate with normal engineering workflow including issues, PRs, review, and
  benchmarking
- prove, with retained benchmark evidence, that it produces better verified
  outcomes than direct Claude Code or Codex use

If OpenMythos cannot do those things and prove them, it is still a promising
harness, not yet the default one.
