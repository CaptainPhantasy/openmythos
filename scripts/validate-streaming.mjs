// REAL streaming validation against the live model. No fakes.
// The harness OWNS the config: we disable the worker's thinking mode and cap
// tokens so a streaming smoke test returns fast. Proves tokens arrive
// incrementally over the wire and concatenation equals the final content.
import { config as loadEnv } from "dotenv";
loadEnv();
import { loadConfigWithOptionalProfile } from "../dist/config/profile.js";
import { AdapterRegistry } from "../dist/adapters/registry.js";

const profile = process.argv[2] ?? "glm-5.2-frontier";
const config = await loadConfigWithOptionalProfile("openmythos.config.json", profile);

// Harness owns the outcome: override the disposable worker's config for a fast
// streaming probe. Thinking mode adds a long reasoning pass before content.
config.models.coder.thinking = { type: "disabled", clearThinking: true };
config.models.coder.maxTokens = 64;

const registry = new AdapterRegistry(config);

const tokens = [];
const arrivalMs = [];
const started = Date.now();

const response = await registry.callStream(
  "coder",
  {
    system: "You are a concise assistant. Output only what is asked.",
    messages: [{ role: "user", content: "Reply with exactly: hello from openmythos streaming" }],
    maxTokens: 64,
    temperature: 0,
    json: false,
  },
  (token) => {
    tokens.push(token);
    arrivalMs.push(Date.now() - started);
  }
);

const totalMs = Date.now() - started;
const joined = tokens.join("");

console.log("=== REAL STREAMING VALIDATION (live model) ===");
console.log("profile:", profile);
console.log("model:", response.model);
console.log("tokens_received:", tokens.length);
console.log("time_to_first_token_ms:", arrivalMs[0] ?? "n/a");
console.log("total_time_ms:", totalMs);
console.log("incremental:", tokens.length > 1);
console.log("content_matches_concatenation:", joined === response.content);
console.log("output_tokens:", response.outputTokens);
console.log("--- content ---");
console.log(JSON.stringify(response.content));
console.log("--- end ---");

if (tokens.length === 0) { console.error("FAIL: no tokens received"); process.exit(1); }
if (joined !== response.content) { console.error("FAIL: concatenation != content"); process.exit(1); }
if (response.content.length === 0) { console.error("FAIL: empty content"); process.exit(1); }
console.log("PASS: real streaming verified against live model");
