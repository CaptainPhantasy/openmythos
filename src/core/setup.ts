import { existsSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverConfigPath, formatConfigDiscoveryFailure, type ConfigDiscoverySource } from "../config/discovery.js";
import { loadConfigWithOptionalProfile } from "../config/profile.js";
import type { OpenMythosConfig } from "../config/schema.js";
import { executeCommand } from "../tools/shell.js";

export interface SetupCheckItem {
  id: string;
  summary: string;
  detail: string;
}

export interface SetupReport {
  timestamp: string;
  workdir: string;
  configPath: string;
  configSearchPaths: string[];
  configSource: ConfigDiscoverySource;
  profile: string | null;
  passed: boolean;
  config: {
    modelCount: number;
    nonFakeModelCount: number;
    requiredApiKeyVars: string[];
  };
  errors: SetupCheckItem[];
  warnings: SetupCheckItem[];
  recommendations: string[];
}

export interface SetupCheckOptions {
  workdir: string;
  configPath: string;
  profileName?: string | undefined;
}

function resolveWorkdir(workdir: string): string {
  return resolve(workdir);
}

function resolveProfileLabel(profile?: string): string | null {
  return profile ? profile : null;
}

function requiredApiKeyEnvVar(config: OpenMythosConfig, adapter: OpenMythosConfig["models"][keyof OpenMythosConfig["models"]]["adapter"], apiKeyEnv?: string): string {
  if (apiKeyEnv && apiKeyEnv.trim().length > 0) {
    return apiKeyEnv;
  }
  return adapter === "glm" || adapter === "zai-coding" ? "ZAI_API_KEY" : "OPENAI_API_KEY";
}

async function pathIsReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK | constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertGitRepo(workdir: string, issues: SetupCheckItem[]): Promise<void> {
  const result = await executeCommand("git", ["rev-parse", "--is-inside-worktree"], workdir, 5000);
  if (result.exitCode !== 0) {
    issues.push({
      id: "git-not-repo",
      summary: "Working directory is not a git repository",
      detail: "Enable `governance.requireGitRepo` or run setup inside a git checkout."
    });
  }
}

function addRecommendation(list: string[], item: string): void {
  if (!list.includes(item)) {
    list.push(item);
  }
}

export async function runSetupCheck(options: SetupCheckOptions): Promise<SetupReport> {
  const workdir = resolveWorkdir(options.workdir);
  const configResolution = discoverConfigPath(options.configPath, workdir);
  const configPath = configResolution.path;
  const warnings: SetupCheckItem[] = [];
  const errors: SetupCheckItem[] = [];
  const recommendations: string[] = [];
  const requiredApiKeyVars = new Set<string>();

  if (!existsSync(configPath)) {
    errors.push({
      id: "config-missing",
      summary: `Config file not found: ${configPath}`,
      detail: formatConfigDiscoveryFailure(configResolution)
    });
    return {
      timestamp: new Date().toISOString(),
      workdir,
      configPath,
      configSearchPaths: configResolution.searched,
      configSource: configResolution.source,
      profile: resolveProfileLabel(options.profileName),
      passed: false,
      config: { modelCount: 0, nonFakeModelCount: 0, requiredApiKeyVars: [] },
      errors,
      warnings,
      recommendations
    };
  }

  if (!(await pathIsReadable(configPath))) {
    errors.push({
      id: "config-unreadable",
      summary: `Config file is not readable: ${configPath}`,
      detail: "Fix file permissions so OpenMythos can load runtime configuration."
    });
  }

  if (!existsSync(workdir)) {
    errors.push({
      id: "workdir-missing",
      summary: `Working directory does not exist: ${workdir}`,
      detail: "Create the directory and point --workdir to a valid path."
    });
  }
  if (errors.length > 0 && errors[0]?.id === "config-missing") {
    addRecommendation(recommendations, "Run `cp openmythos.config.example.json openmythos.config.json` from a template.");
    return {
      timestamp: new Date().toISOString(),
      workdir,
      configPath,
      configSearchPaths: configResolution.searched,
      configSource: configResolution.source,
      profile: resolveProfileLabel(options.profileName),
      passed: false,
      config: { modelCount: 0, nonFakeModelCount: 0, requiredApiKeyVars: [] },
      errors,
      warnings,
      recommendations
    };
  }

  const config = await loadConfigWithOptionalProfile(configPath, options.profileName);

  const modelEntries = Object.entries(config.models);
  const nonFakeModelCount = modelEntries.filter(([, model]) => model.adapter !== "fake").length;
  const modelWarnings: string[] = [];
  for (const [role, model] of modelEntries) {
    const keyEnv = requiredApiKeyEnvVar(config, model.adapter, model.apiKeyEnv);
    requiredApiKeyVars.add(keyEnv);
    if (model.adapter === "fake") {
      warnings.push({
        id: `${role}-fake-model`,
        summary: `${role} role is using the fake adapter`,
        detail: "Fake adapter is useful for deterministic testing only and is not suitable for product readiness claims."
      });
      continue;
    }
    if (process.env[keyEnv] === undefined || process.env[keyEnv].trim().length === 0) {
      errors.push({
        id: `${role}-missing-key`,
        summary: `Missing API key for ${role} (${model.model})`,
        detail: `${keyEnv} is required for adapter ${model.adapter} and model ${model.model}.`
      });
    } else if (keyEnv === "ZAI_API_KEY" && process.env[keyEnv]?.startsWith("REDACTED")) {
      warnings.push({
        id: `${role}-suspicious-key`,
        summary: `ZAI_API_KEY appears to be placeholder text for ${role}`,
        detail: "Replace placeholder credentials before using networked runs."
      });
    }
  }

  if (config.governance.requireGitRepo) {
    await assertGitRepo(workdir, errors);
  }

  if (nonFakeModelCount === 0) {
    errors.push({
      id: "no-real-models",
      summary: "All configured model roles are using fake adapter",
      detail: "A real model profile is required for meaningful harness execution and real-evidence workflows."
    });
  }

  if (errors.length === 0) {
    addRecommendation(recommendations, "Try a first run: `openmythos run 'fix a tiny issue in this repo' --profile <profile-name>`");
    addRecommendation(recommendations, "Run `openmythos run --profile <profile> --goal` then `openmythos tui --once` to inspect artifacts.");
  }
  if (warnings.length > 0) {
    addRecommendation(recommendations, "Address warnings before default production use.");
  }

  return {
    timestamp: new Date().toISOString(),
    workdir,
    configPath,
    configSearchPaths: configResolution.searched,
    configSource: configResolution.source,
    profile: resolveProfileLabel(options.profileName),
    passed: errors.length === 0,
    config: {
      modelCount: modelEntries.length,
      nonFakeModelCount,
      requiredApiKeyVars: [...requiredApiKeyVars].sort()
    },
    errors,
    warnings,
    recommendations
  };
}
