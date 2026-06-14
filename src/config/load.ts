import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openMythosConfigSchema, type OpenMythosConfig } from "./schema.js";

export async function loadConfig(path: string): Promise<OpenMythosConfig> {
  const configPath = resolve(path);
  const raw = await readFile(configPath, "utf8");
  return openMythosConfigSchema.parse(JSON.parse(raw));
}
