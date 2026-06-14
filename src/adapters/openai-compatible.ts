import type { ModelConfig } from "../config/schema.js";
import type { AdapterRequest, AdapterResponse } from "../core/types.js";
import { fetchWithBackoff, requiredEnv, type ModelAdapter } from "./base.js";

export class OpenAiCompatibleAdapter implements ModelAdapter {
  private static readonly lastCallByModel = new Map<string, number>();

  constructor(private readonly config: ModelConfig) {}

  async call(request: AdapterRequest): Promise<AdapterResponse> {
    const started = Date.now();
    await this.applyRateLimit();
    const baseUrl = this.baseUrl();
    const response = await fetchWithBackoff(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requiredEnv(this.apiKeyEnv())}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(buildChatCompletionsBody(this.config, request))
    });

    const data = await response.json() as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: data.model ?? this.config.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - started
    };
  }

  private baseUrl(): string {
    if (this.config.baseUrl) {
      return this.config.baseUrl.replace(/\/$/, "");
    }
    if (this.config.adapter === "zai-coding") {
      return (process.env.ZAI_CODING_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4").replace(/\/$/, "");
    }
    if (this.config.adapter === "glm") {
      return (process.env.ZAI_GENERAL_BASE_URL ?? process.env.GLM_BASE_URL ?? "https://api.z.ai/api/paas/v4").replace(/\/$/, "");
    }
    return (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  private apiKeyEnv(): string {
    if (this.config.apiKeyEnv) {
      return this.config.apiKeyEnv;
    }
    return this.config.adapter === "glm" || this.config.adapter === "zai-coding" ? "ZAI_API_KEY" : "OPENAI_API_KEY";
  }

  private async applyRateLimit(): Promise<void> {
    const rpm = this.config.rateLimit?.requestsPerMinute;
    if (!rpm) {
      return;
    }
    const key = `${this.config.adapter}:${this.config.model}`;
    const minIntervalMs = Math.ceil(60000 / rpm);
    const lastCall = OpenAiCompatibleAdapter.lastCallByModel.get(key) ?? 0;
    const waitMs = minIntervalMs - (Date.now() - lastCall);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    OpenAiCompatibleAdapter.lastCallByModel.set(key, Date.now());
  }
}

export function buildChatCompletionsBody(config: ModelConfig, request: AdapterRequest): Record<string, unknown> {
  return {
    model: config.model,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    stream: false,
    messages: [
      { role: "system", content: request.system },
      ...request.messages
    ],
    ...(request.json ? { response_format: { type: "json_object" } } : {}),
    ...(config.adapter === "glm" || config.adapter === "zai-coding"
      ? {
          thinking: {
            type: config.thinking.type,
            clear_thinking: config.thinking.clearThinking
          }
        }
      : {})
  };
}
