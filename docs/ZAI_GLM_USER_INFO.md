# Z.AI GLM User Info Sheet

This is the OpenMythos default guide for using Z.AI GLM models in coding
projects. It is based on the Z.AI API/coding-plan details provided on
2026-06-14 and should be copied into other projects when GLM routing decisions
need to stay consistent.

## Endpoints

Use the coding endpoint for coding-package work:

```text
https://api.z.ai/api/coding/paas/v4
```

Use the general API endpoint only for non-coding API scenarios:

```text
https://api.z.ai/api/paas/v4
```

OpenMythos should use:

```text
adapter: zai-coding
apiKeyEnv: ZAI_API_KEY
baseUrl: https://api.z.ai/api/coding/paas/v4
```

Do not route coding-plan traffic through the general endpoint unless the task is
not a coding-plan scenario.

## Current OpenMythos Default

Until GLM-5.2 is tested independently, use:

```text
glm-5.1
```

OpenMythos defaults all active roles to `glm-5.1`:

```text
planner    -> glm-5.1
compressor -> glm-5.1
coder      -> glm-5.1
critic     -> glm-5.1
verifier   -> glm-5.1
```

This is conservative. It avoids moving the harness to GLM-5.2 before there is
separate evidence that 5.2 behaves correctly in this workflow.

### Endpoint aliasing (verified 2026-06-15)

The coding endpoint serves a requested `glm-5.1` as `glm-5.2`: the request
sends `model: glm-5.1` but the response reports `model: glm-5.2` (confirmed via
`scripts/diag-model.mjs glm-5.1`). The `glm-5.1` SKU therefore gets 5.2-class
quality while keeping the 5.1 concurrency limit (10). Requesting `glm-5.2`
directly uses the 5.2 SKU (limit 2). The harness fan-out cap derives from each
model's configured `rateLimit.requestsPerMinute`, so keep `glm-5.1` at 10 and
`glm-5.2` at 2 to match the SKU limits regardless of the served model.

## Thinking Configuration

GLM-5.1, GLM-5, and the GLM-4.7 series activate thinking by default. GLM-4.6
uses a different hybrid-thinking default.

For OpenMythos, use explicit thinking settings:

```json
{
  "thinking": {
    "type": "enabled",
    "clearThinking": true
  }
}
```

`clearThinking: true` is intentional for the current harness. Z.AI preserved
thinking can improve coding-agent continuity, but it requires returning the
complete unmodified `reasoning_content` blocks in later requests. OpenMythos
does not yet persist or replay reasoning blocks, so preserved thinking should
not be enabled here until the adapter supports it end to end.

When OpenMythos gains preserved-thinking support, the requirement is strict:

- capture every `reasoning_content` block returned by the model;
- persist it in the run artifact history;
- replay it unchanged in the same sequence;
- do not edit, summarize, reorder, or omit reasoning blocks.

## Model Use Cases

### GLM-5.1

Use for current coding-harness work.

Best fit:

- planning complex implementation tasks;
- code generation and repair;
- multi-step debugging;
- verifier/QA passes;
- agent loops where thinking should stay enabled.

OpenMythos status:

```text
default model until GLM-5.2 is separately tested
provided limit: 10
```

### GLM-5

Use when a strong GLM-5-class model is needed but 5.1 is not specifically
required.

Best fit:

- heavier reasoning than routine Flash/Air models;
- coding tasks where quota should be conserved compared with 5.1;
- fallback for complex work if 5.1 is constrained.

Provided limit:

```text
2
```

### GLM-5-Turbo

Use carefully. The Z.AI coding-plan notes group GLM-5-Turbo with advanced models
intended to rival Opus-class work, with higher quota draw during peak periods.

Best fit:

- high-value coding turns;
- difficult planning or debugging where latency/cost tradeoff is acceptable;
- comparison lane against GLM-5.1 or GLM-5.2.

Avoid for:

- routine context compression;
- cheap file summarization;
- repeated retry loops unless the task justifies the quota burn.

Provided limit:

```text
1
```

### GLM-5.2

Do not make this OpenMythos default yet. Test independently first.

Best fit after validation:

- hardest coding tasks;
- architecture plans;
- high-stakes QA;
- comparison lane against GLM-5.1.

Quota note from Z.AI coding-plan material:

- GLM-5.2 and GLM-5-Turbo can consume higher quota during peak hours.
- Peak hours are 14:00-18:00 UTC+8.
- Use GLM-4.7 for routine tasks when preserving quota matters.

OpenMythos policy:

```text
available for future experiments, not default
```

## Other Provided Model Limits

Treat the final numeric column below as the user-provided model-specific limit
value for routing and quota awareness. In OpenMythos config, map that value to
`rateLimit.requestsPerMinute` only when it is confirmed to represent RPM.

| Type | Model | Provided limit |
|---|---:|---:|
| Language | GLM-4.6 | 3 |
| Language | GLM-4.6V-FlashX | 3 |
| Language | GLM-4.7 | 2 |
| Image | GLM-Image | 1 |
| Language | GLM-5-Turbo | 1 |
| Language | GLM-5V-Turbo | 1 |
| Language | GLM-5.1 | 10 |
| Language | GLM-4.5 | 10 |
| Language | GLM-4.6V | 10 |
| Language | GLM-4.7-Flash | 1 |
| Language | GLM-4.7-FlashX | 3 |
| Language | GLM-OCR | 2 |
| Language | GLM-5 | 2 |
| Language | GLM-4-Plus | 20 |
| Language | GLM-4.5V | 10 |
| Language | GLM-4.6V-Flash | 1 |
| Language | Auto GLM-Phone-Multilingual | 5 |
| Language | GLM-4.5-Air | 5 |
| Language | GLM-4.5-AirX | 5 |
| Language | GLM-4.5-Flash | 2 |
| Language | GLM-4-32B-0414-128K | 15 |

## Practical Routing Guidance

Use this conservative routing until there is benchmark evidence:

| Harness role | Default | Reason |
|---|---|---|
| planner | GLM-5.1 | strongest currently approved model for orchestration |
| compressor | GLM-5.1 | accuracy over cheap compression until eval data exists |
| coder | GLM-5.1 | primary coding worker |
| critic | GLM-5.1 | strong review catches more defects |
| verifier | GLM-5.1 | QA should be stricter than the implementation path |

Future cost-optimized routing candidates:

| Harness role | Candidate | When to consider |
|---|---|---|
| compressor | GLM-4.5-Air or GLM-4.5-AirX | after context-summary evals pass |
| routine coder | GLM-4.7 | low-risk edits or quota conservation |
| high-stakes planner | GLM-5.2 | after independent 5.2 validation |
| visual/OCR tasks | GLM-4.6V, GLM-4.5V, GLM-OCR | only when inputs require vision/OCR |

## API Request Shape

For coding-package traffic:

```bash
curl -X POST "https://api.z.ai/api/coding/paas/v4/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ZAI_API_KEY" \
  -d '{
    "model": "glm-5.1",
    "messages": [
      { "role": "user", "content": "Implement the requested change." }
    ],
    "thinking": {
      "type": "enabled",
      "clear_thinking": true
    },
    "stream": false,
    "max_tokens": 4096,
    "temperature": 0.2
  }'
```

Use `stream: false` in OpenMythos until the adapter explicitly supports
streaming deltas, tool-call deltas, and reasoning-content preservation.

## Security Rules

- Never commit API keys.
- Store the key in `.env` as `ZAI_API_KEY`.
- Keep `.env` ignored.
- Rotate the key if it appears in a public log, repo, screenshot, or shared
  transcript.

## OpenMythos Notes

The current adapter sends Z.AI/GLM requests as OpenAI-compatible
`/chat/completions` calls with:

- `thinking.type`;
- `thinking.clear_thinking`;
- `stream: false`;
- role-specific `max_tokens`;
- role-specific `temperature`;
- optional per-model pacing via `rateLimit.requestsPerMinute`.

The harness owns retries and state. GLM models are workers, not the controller.
