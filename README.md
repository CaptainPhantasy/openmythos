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
- Local verification commands before model QA.
- Adapter profiles for fake, Z.AI GLM coding, and frontier model experiments.
- Retained `metrics.json` artifacts and benchmark aggregation with `bench`.
- Consecutive-round eval command for proving harness stability.
- Read-only TUI for inspecting run state and event logs.

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

Run the deterministic fake eval:

```bash
node dist/index.js eval --profile fake --rounds 10
```

Run the live Z.AI marker-file gate:

```bash
node dist/index.js eval \
  --profile zai-live-gate \
  --rounds 15 \
  --workdir runs/live-evals \
  --goal "Create exactly one file named openmythos-live-output.txt whose complete content is OPENMYTHOS_LIVE_SUCCESS followed by a newline. Do not modify any other files."
```

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

Approval policy:

- `approval.mode = "suggest"` writes per-task review artifacts without blocking.
- `approval.mode = "enforce"` stops the run with `awaiting_approval` when a task
  proposes high-risk edits such as deletes, protected-path writes, or
  credential-like file changes.
- Review artifacts are written into each run directory as `review-<task>.json`
  and `review-<task>.patch`.

## Runtime Artifacts

Each run writes an inspectable artifact set:

- `state.json`: phase, status, retry count, timestamps, final output.
- `events.jsonl`: append-only event ledger.
- `intake.json`: task classification and success criteria.
- `context.json`: selected file manifest and compressed context.
- `plan.json`: schema-validated execution plan.
- `outputs.json`: schema-validated worker outputs and file edits.
- `qa.json`: local and model verification result.
- `metrics.json`: retained run metrics, including model calls, token totals,
  durations, edit counts, and verification counts.
- `final.md`: final execution report.
- `*-invalid-attempt-*.txt`: raw invalid model responses saved during bounded
  JSON repair.

Plan task contract:

- planners can now specify `requiredTools` and `executionMode`
- the harness can batch dependency-free tasks when they are marked
  `executionMode = "parallel"` and do not target the same files

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
