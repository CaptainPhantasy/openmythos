import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { openMythosConfigSchema, type OpenMythosConfig } from "./schema.js";

export async function loadConfigWithOptionalProfile(
  configPath: string,
  profileNameOrPath?: string
): Promise<OpenMythosConfig> {
  const resolvedConfig = resolve(configPath);
  const base = JSON.parse(await readFile(resolvedConfig, "utf8")) as Record<string, unknown>;
  if (!profileNameOrPath) {
    return openMythosConfigSchema.parse(base);
  }

  const profilePath = profileNameOrPath.endsWith(".json")
    ? resolve(profileNameOrPath)
    : resolve(dirname(resolvedConfig), "profiles", `${profileNameOrPath}.json`);
  const overlay = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;
  return openMythosConfigSchema.parse(deepMerge(base, overlay));
}

export function deepMerge(base: unknown, overlay: unknown): unknown {
  if (!isRecord(base) || !isRecord(overlay)) {
    return overlay;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = key in merged ? deepMerge(merged[key], value) : value;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
