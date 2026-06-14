# OpenMythos 2027 Default Harness Roadmap

## Purpose

This document identifies where OpenMythos still falls short of being a
developer's default daily coding harness and defines the phases required to
close those gaps.

The target is not "a clever orchestrator." The target is a full agentic coding
tool that a developer can trust as a primary execution surface in 2027.

## Current Baseline

OpenMythos already has a credible deterministic core:

- Code owns the main loop: `intake -> context -> plan -> execute -> verify`.
- Run state and artifacts are persisted to disk under `runs/`.
- Model output is schema-validated and retried on malformed JSON.
- Local verification commands can gate model QA.
- There is a basic CLI, a read-only TUI, and a separate VOID-style terminal UI.
- Z.AI / GLM and other model adapters already exist behind a common registry.

That is a strong harness foundation. It is not yet a full default coding
harness.

## What Still Lacks

### 1. Execution Model Is Too Narrow

Today the harness is a linear five-role pipeline. It does not yet support:

- true sub-agent routing
- concurrent task execution
- tool-using worker turns inside a single task
- model selection per task based on cost, latency, or difficulty
- long-running background jobs with progress tracking

Implication:
OpenMythos can run a deterministic plan, but it cannot yet behave like a strong
multi-tool coding agent that decomposes, fans out, and converges.

### 2. Action Space Is Too Coarse

The current workers mainly return full-file edits plus summaries. That is not
enough for a default harness. It still lacks:

- patch-level edit actions
- structured search/read/symbol tools for workers
- git-aware actions such as branch creation, staged diff review, and commit prep
- browser, API, database, and package-manager tool surfaces
- tool outputs with consistent recovery hints and next-step contracts

Implication:
The model is still forced into large-file rewrite behavior too often, which is
slower, riskier, and less controllable than a modern coding harness should be.

### 3. Context Building Is Still Primitive

Current context gathering is file-list based and pattern-biased. It does not yet
provide:

- symbol-aware indexing
- semantic search and retrieval
- test-impact analysis
- dependency graph awareness
- change-surface ranking
- repo memory beyond per-run artifacts

Implication:
OpenMythos can gather context, but not yet with the precision and compression a
large codebase demands.

### 4. Verification Is Not Strong Enough

The current verification path is "run optional local commands, then ask a model
to judge the result." For a 2027 default harness, that is necessary but not
sufficient. Missing layers include:

- first-class lint/build/test policies
- diff-based regression checks
- browser and UI verification
- contract/API validation
- security and secret scans
- performance and resource guards
- explicit pass/fail gates by risk class

Implication:
The harness can verify a task, but not yet at the bar where a developer trusts
it to touch production code every day.

### 5. Human Control Surface Is Incomplete

The CLI and TUI are still inspection-first, not execution-native. Missing
capabilities include:

- interactive approval gates for risky actions
- artifact drill-down from the TUI
- diff preview and accept/reject workflow
- run editing, retry selection, and phase replay
- side-by-side model output review
- task queueing and background run management

Implication:
The system is observable, but not yet ergonomic enough to replace a developer's
main harness.

### 6. Safety Model Is Not Yet Operationally Complete

There is some governance and port claiming, but a default harness needs much
more:

- branch or workspace isolation by default
- quarantine semantics for deletions and risky rewrites
- secret redaction in artifacts
- policy enforcement for forbidden paths and commands
- approval requirements by action category
- resumable crash-safe rollback or recovery points

Implication:
The current harness is disciplined, but not yet hardened for routine autonomous
repo work.

### 7. Collaboration Features Are Thin

OpenMythos does not yet act like a teammate inside real software workflows. It
still lacks:

- issue / PR / task integration
- review mode with finding severity and code references
- team memory and durable project notes
- multi-run trace comparison
- benchmark history across models and profiles

Implication:
It can execute runs, but it cannot yet live comfortably inside normal
engineering collaboration loops.

### 8. Operations and Benchmarking Are Still Minimal

The harness has runs and events, but not yet full operational observability:

- success-rate dashboards
- pass@1 and pass@N tracking
- cost and latency accounting
- profile quality comparisons
- failure taxonomy
- replayable benchmark suites on real tasks

Implication:
It is hard to prove that the harness is improving, regressing, or ready to be a
default tool.

## Phased Build Plan

### Phase 0: Harden The Existing Core

Goal:
Turn the current deterministic runner into a safer foundation.

Required steps:

- add structured tool-result envelopes with `status`, `summary`, `nextActions`,
  and `artifacts`
- add explicit risk classes for actions and verification gates
- add artifact redaction rules for secrets and sensitive runtime values
- add deletion quarantine and branch-safe write modes
- add richer failure causes and repair paths in run events

Exit criteria:

- every failure mode yields a clear retry or stop instruction
- risky file actions can be blocked or quarantined
- artifact logs are safe to retain locally

### Phase 1: Expand The Action Space

Goal:
Give the harness the tool surface expected of a serious coding agent.

Required steps:

- add structured read/search/symbol tools
- add patch-level edit actions in addition to full-file rewrites
- add first-class git actions for branch, diff, stage, and commit prep
- add browser/API/package-manager/database tool adapters where appropriate
- allow workers to use tools during task execution rather than only returning
  file edits

Exit criteria:

- the harness can solve common coding tasks without relying on full-file rewrite
  as the default move
- tool outputs are deterministic and recovery-friendly

### Phase 2: Replace Flat Context With Retrieval

Goal:
Make context selection accurate on larger repos.

Required steps:

- build symbol and file indices
- add semantic retrieval over code and docs
- add dependency and test-impact graphing
- rank files by probable relevance instead of shallow glob priority
- persist reusable repo memory outside individual runs

Exit criteria:

- context packs are smaller, more relevant, and reproducible
- the harness can explain why each file was selected

### Phase 3: Move From Linear Pipeline To Directed Execution

Goal:
Support real agentic work instead of only single-lane orchestration.

Required steps:

- add task fan-out and join behavior
- add sub-agent routing by task type
- add planner ability to choose among tool-capable workers
- add bounded background jobs and progress reporting
- add model portfolio policies for cost, latency, and difficulty

Exit criteria:

- a task can be decomposed into parallel or staged workers safely
- the harness still owns orchestration and stop conditions

### Phase 4: Make Verification First-Class

Goal:
Upgrade verification from "optional local commands plus model QA" to a real
quality gate.

Required steps:

- define verification presets by task class
- add lint/build/test contract runners
- add browser and UI verification flows
- add security, secret, and dependency scanning
- add diff-aware regression heuristics
- require evidence-backed completion receipts

Exit criteria:

- completion means verified, not merely plausible
- high-risk tasks cannot pass on model judgment alone

### Phase 5: Build The Real Operator Surface

Goal:
Make OpenMythos usable as the main daily harness.

Required steps:

- upgrade the TUI from read-only dashboard to active run control surface
- add diff preview and approval flows
- add artifact navigation, search, and replay
- add queueing, background run management, and cancellation
- unify CLI, TUI, and VOID terminal around the same execution backend

Exit criteria:

- a developer can drive planning, execution, verification, and review without
  leaving the harness for routine work

### Phase 6: Integrate Collaboration and Memory

Goal:
Make the harness operate naturally inside engineering workflows.

Required steps:

- add issue / PR / task-system adapters
- add durable repo notes and team memory
- add code-review mode with severity-ranked findings
- add run-to-run comparison and benchmark history
- add knowledge capture from completed work

Exit criteria:

- the harness behaves like a coding teammate, not just a run engine

### Phase 7: Prove It Under Real Workloads

Goal:
Demonstrate default-harness reliability with hard evidence.

Required steps:

- build a benchmark suite of real multi-step repo tasks
- track completion rate, retries, cost, latency, and regression rate
- run continuous profile comparisons across supported models
- define promotion gates for new model or tool profiles
- publish a stable readiness score for the harness itself

Exit criteria:

- OpenMythos can be evaluated as an engineering system, not just described as
  one

## Final Goal

The final goal is this:

OpenMythos becomes a full agentic coding tool that a developer can use as the
default harness for daily software work in 2027.

That means a developer can point it at a repository and expect it to:

- understand the repo with precise retrieval instead of brute-force context
- plan and decompose tasks into the right workers and tools
- edit code with patch-safe, reviewable actions
- verify changes with strong local and external evidence
- respect governance, secrets, branch safety, and risky-action approvals
- expose a fast terminal-native operator surface
- integrate with normal engineering workflows such as review, issues, and
  benchmarking
- improve measurably over time through retained metrics and replayable evals

If OpenMythos cannot do those things reliably, it is still a promising harness,
not yet the default one.

