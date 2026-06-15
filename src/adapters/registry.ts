import type { ModelConfig, ModelRole, OpenMythosConfig } from "../config/schema.js";
import type { AdapterRequest, AdapterResponse } from "../core/types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { FakeAdapter } from "./fake.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import type { ModelAdapter, StreamTokenHandler } from "./base.js";

export class AdapterRegistry {
  private readonly adapters = new Map<ModelRole, ModelAdapter>();

  constructor(config: OpenMythosConfig) {
    const modelKeys = Object.keys(config.models) as Array<keyof typeof config.models>;
    for (const role of modelKeys) {
      this.adapters.set(role, this.createAdapter(config.models[role]));
    }
  }

  async call(role: ModelRole, request: AdapterRequest): Promise<AdapterResponse> {
    const adapter = this.adapters.get(role);
    if (!adapter) {
      throw new Error(`No adapter configured for role: ${role}`);
    }
    return adapter.call(request);
  }

  async callStream(role: ModelRole, request: AdapterRequest, onToken: StreamTokenHandler): Promise<AdapterResponse> {
    const adapter = this.adapters.get(role);
    if (!adapter) {
      throw new Error(`No adapter configured for role: ${role}`);
    }
    if (adapter.callStream) {
      return adapter.callStream(request, onToken);
    }
    // Fallback: adapter has no native streaming — emit the full content once.
    const response = await adapter.call(request);
    onToken(response.content);
    return response;
  }

  private createAdapter(config: ModelConfig): ModelAdapter {
    switch (config.adapter) {
      case "anthropic":
        return new AnthropicAdapter(config);
      case "openai":
      case "openai-compatible":
      case "glm":
      case "zai-coding":
        return new OpenAiCompatibleAdapter(config);
      case "fake":
        return new FakeAdapter();
    }
  }
}
