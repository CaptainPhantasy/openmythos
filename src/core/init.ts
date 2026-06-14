import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface ProviderPreset {
  id: string;
  name: string;
  adapter: string;
  apiKeyEnv: string;
  models: {
    planner: string;
    compressor: string;
    coder: string;
    critic: string;
    verifier: string;
  };
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

export function getProviderPresets(): ProviderPreset[] {
  return [
    {
      id: "zai",
      name: "ZhipuAI (GLM)",
      adapter: "zai-coding",
      apiKeyEnv: "ZAI_API_KEY",
      models: {
        planner: "glm-5.1",
        compressor: "glm-5.1",
        coder: "glm-5.1",
        critic: "glm-5.1",
        verifier: "glm-5.1",
      },
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      maxTokens: 8192,
      temperature: 0.2,
    },
    {
      id: "openai",
      name: "OpenAI (GPT)",
      adapter: "openai",
      apiKeyEnv: "OPENAI_API_KEY",
      models: {
        planner: "gpt-4o",
        compressor: "gpt-4o",
        coder: "gpt-4o",
        critic: "gpt-4o",
        verifier: "gpt-4o",
      },
      baseUrl: "https://api.openai.com/v1",
      maxTokens: 8192,
      temperature: 0.2,
    },
    {
      id: "anthropic",
      name: "Anthropic (Claude)",
      adapter: "anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      models: {
        planner: "claude-sonnet-4-20250514",
        compressor: "claude-sonnet-4-20250514",
        coder: "claude-sonnet-4-20250514",
        critic: "claude-sonnet-4-20250514",
        verifier: "claude-sonnet-4-20250514",
      },
      baseUrl: "https://api.anthropic.com/v1",
      maxTokens: 8192,
      temperature: 0.2,
    },
    {
      id: "gemini",
      name: "Google (Gemini)",
      adapter: "openai",
      apiKeyEnv: "GEMINI_API_KEY",
      models: {
        planner: "gemini-2.5-flash",
        compressor: "gemini-2.5-flash",
        coder: "gemini-2.5-flash",
        critic: "gemini-2.5-flash",
        verifier: "gemini-2.5-flash",
      },
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      maxTokens: 8192,
      temperature: 0.2,
    },
  ];
}

export function detectProviderFromEnv(): ProviderPreset | null {
  const presets = getProviderPresets();
  for (const preset of presets) {
    if (process.env[preset.apiKeyEnv]) {
      return preset;
    }
  }
  return null;
}

export function generateConfig(preset: ProviderPreset): Record<string, unknown> {
  const modelBlock = (model: string) => {
    const block: Record<string, unknown> = {
      adapter: preset.adapter,
      model,
      maxTokens: preset.maxTokens,
      temperature: preset.temperature,
      apiKeyEnv: preset.apiKeyEnv,
    };
    if (preset.baseUrl) {
      block.baseUrl = preset.baseUrl;
    }
    return block;
  };

  return {
    models: {
      planner: modelBlock(preset.models.planner),
      compressor: modelBlock(preset.models.compressor),
      coder: modelBlock(preset.models.coder),
      critic: modelBlock(preset.models.critic),
      verifier: modelBlock(preset.models.verifier),
    },
    execution: {
      maxRetries: 2,
      maxTaskToolTurns: 5,
      timeoutMs: 120000,
      workingDirectory: ".",
    },
    context: {
      maxFiles: 80,
      maxFileSizeBytes: 120000,
      ignorePatterns: ["node_modules", ".git", "dist", "build", ".openmythos"],
      ignoreExtensions: [".lock", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2"],
    },
    verification: {
      localCommands: [],
      requireLocalPassBeforeModelQa: false,
      presets: {
        default: [],
        byRisk: { low: [], medium: [], high: [] },
        byTaskType: {
          lint: [],
          build: [],
          test: [],
          browser: [],
          api: [],
          database: [],
          security: [],
          performance: [],
        },
      },
    },
    approval: {
      mode: "suggest",
      protectedPaths: ["package.json", "package-lock.json", ".git"],
    },
    governance: {
      requireGitRepo: false,
      dirtyWorktree: "warn",
      protectedBranchMode: "warn",
      protectedBranches: ["main", "master"],
    },
  };
}

export interface InitResult {
  configPath: string;
  provider: string;
  apiKeyEnv: string;
  apiKeyPresent: boolean;
  alreadyExisted: boolean;
}

export async function runInit(
  workdir: string,
  providerId?: string
): Promise<InitResult> {
  const configPath = resolve(workdir, "openmythos.config.json");

  if (existsSync(configPath)) {
    return {
      configPath,
      provider: "existing",
      apiKeyEnv: "",
      apiKeyPresent: false,
      alreadyExisted: true,
    };
  }

  let preset: ProviderPreset;
  if (providerId) {
    const found = getProviderPresets().find((p) => p.id === providerId);
    if (!found) {
      throw new Error(`Unknown provider: ${providerId}. Available: ${getProviderPresets().map((p) => p.id).join(", ")}`);
    }
    preset = found;
  } else {
    const detected = detectProviderFromEnv();
    if (!detected) {
      throw new Error(
        "No API key detected. Set one of: " +
        getProviderPresets().map((p) => p.apiKeyEnv).join(", ") +
        " or specify --provider <id>"
      );
    }
    preset = detected;
  }

  const config = generateConfig(preset);
  await mkdir(workdir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  return {
    configPath,
    provider: preset.name,
    apiKeyEnv: preset.apiKeyEnv,
    apiKeyPresent: !!process.env[preset.apiKeyEnv],
    alreadyExisted: false,
  };
}
