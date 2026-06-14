import type { OpenMythosConfig } from "../config/schema.js";
import { listTextFiles, readRelativeFile } from "../tools/files.js";

export interface RawContext {
  manifest: string[];
  files: Record<string, string>;
}

export async function gatherContext(
  workdir: string,
  config: OpenMythosConfig["context"],
  relevantPatterns: string[]
): Promise<RawContext> {
  const files = await listTextFiles(
    workdir,
    config.ignorePatterns,
    config.ignoreExtensions,
    config.maxFileSizeBytes,
    config.maxFiles * 2
  );

  const sorted = [...files].sort((a, b) => {
    const aScore = scorePattern(a.relativePath, relevantPatterns);
    const bScore = scorePattern(b.relativePath, relevantPatterns);
    return bScore - aScore || a.relativePath.localeCompare(b.relativePath);
  });

  const manifest = sorted.slice(0, config.maxFiles).map((file) => file.relativePath);
  const content: Record<string, string> = {};
  for (const path of manifest) {
    content[path] = await readRelativeFile(workdir, path);
  }
  return { manifest, files: content };
}

function scorePattern(path: string, patterns: string[]): number {
  if (patterns.length === 0) {
    return 0;
  }
  return patterns.some((pattern) => matchGlob(path, pattern)) ? 1 : 0;
}

export function matchGlob(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}
