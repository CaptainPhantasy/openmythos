import type { ModelConfig, ModelRole, OpenMythosConfig } from "../config/schema.js";
import type { AdapterRequest, AdapterResponse } from "../core/types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { FakeAdapter } from "./fake.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import type { ModelAdapter } from "./base.js";

export class AdapterRegistry {
  private readonly adapters = new Map<ModelRole, ModelAdapter>();

  constructor(config: OpenMythosConfig) {
    for (const role of Object.keys(config.models) as ModelRole[]) {
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
