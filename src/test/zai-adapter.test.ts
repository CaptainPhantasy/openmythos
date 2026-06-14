import assert from "node:assert/strict";
import test from "node:test";
import { buildChatCompletionsBody } from "../adapters/openai-compatible.js";
import type { ModelConfig } from "../config/schema.js";

test("buildChatCompletionsBody includes ZAI thinking config and disables streaming", () => {
  const config: ModelConfig = {
    adapter: "zai-coding",
    model: "glm-5.1",
    maxTokens: 4096,
    temperature: 0.2,
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    apiKeyEnv: "ZAI_API_KEY",
    thinking: {
      type: "enabled",
      clearThinking: true
    },
    rateLimit: {
      requestsPerMinute: 10
    }
  };

  const body = buildChatCompletionsBody(config, {
    system: "system",
    maxTokens: 1024,
    temperature: 0.1,
    json: true,
    messages: [{ role: "user", content: "hello" }]
  });

  assert.equal(body.model, "glm-5.1");
  assert.equal(body.stream, false);
  assert.deepEqual(body.thinking, {
    type: "enabled",
    clear_thinking: true
  });
  assert.deepEqual(body.response_format, { type: "json_object" });
});
