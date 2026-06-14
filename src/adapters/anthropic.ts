import type { ModelConfig } from "../config/schema.js";
import type { AdapterRequest, AdapterResponse } from "../core/types.js";
import { fetchWithBackoff, requiredEnv, type ModelAdapter } from "./base.js";

export class AnthropicAdapter implements ModelAdapter {
  constructor(private readonly config: ModelConfig) {}

  async call(request: AdapterRequest): Promise<AdapterResponse> {
    const started = Date.now();
    const apiKey = requiredEnv(this.config.apiKeyEnv ?? "ANTHROPIC_API_KEY");
    const response = await fetchWithBackoff("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model,
        system: request.system,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        messages: request.messages
      })
    });

    const data = await response.json() as {
      model?: string;
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";

    return {
      content: text,
      model: data.model ?? this.config.model,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - started
    };
  }
}
