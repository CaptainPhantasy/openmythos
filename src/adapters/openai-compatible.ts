import type { ModelConfig } from "../config/schema.js";
import type { AdapterRequest, AdapterResponse } from "../core/types.js";
import { fetchWithBackoff, requiredEnv, type ModelAdapter, type StreamTokenHandler } from "./base.js";

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
    }, 3, this.config.timeoutMs);

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

  async callStream(request: AdapterRequest, onToken: StreamTokenHandler): Promise<AdapterResponse> {
    const started = Date.now();
    await this.applyRateLimit();
    const baseUrl = this.baseUrl();
    const body = { ...buildChatCompletionsBody(this.config, request), stream: true };
    const response = await fetchWithBackoff(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requiredEnv(this.apiKeyEnv())}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }, 3, this.config.timeoutMs);

    if (!response.body) {
      // No stream available — fall back to a single emission.
      const fallback = await this.call(request);
      onToken(fallback.content);
      return fallback;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let model = this.config.model;
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as {
            model?: string;
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (chunk.model) model = chunk.model;
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
            outputTokens = chunk.usage.completion_tokens ?? outputTokens;
          }
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            onToken(delta);
          }
        } catch {
          // Skip malformed SSE chunks.
        }
      }
    }

    return {
      content,
      model,
      inputTokens,
      outputTokens: outputTokens || Math.ceil(content.length / 4),
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
