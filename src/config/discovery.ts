import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export type ConfigDiscoverySource =
  | "absolute"
  | "cwd"
  | "cwd-ancestor"
  | "workdir"
  | "workdir-ancestor"
  | "missing";

export interface ConfigDiscoveryResult {
  path: string;
  searched: string[];
  source: ConfigDiscoverySource;
}

export function discoverConfigPath(configPath: string, workdir: string, cwd = process.cwd()): ConfigDiscoveryResult {
  if (isAbsolute(configPath)) {
    const absolutePath = resolve(configPath);
    return {
      path: absolutePath,
      searched: [absolutePath],
      source: existsSync(absolutePath) ? "absolute" : "missing"
    };
  }

  const resolvedCwd = resolve(cwd);
  const resolvedWorkdir = resolve(workdir);
  const candidates: Array<{ path: string; source: Exclude<ConfigDiscoverySource, "absolute" | "missing"> }> = [];

  if (isSimpleFileName(configPath)) {
    for (const directory of ancestorDirectories(resolvedWorkdir)) {
      candidates.push({
        path: resolve(directory, configPath),
        source: directory === resolvedWorkdir ? "workdir" : "workdir-ancestor"
      });
    }
    for (const directory of ancestorDirectories(resolvedCwd)) {
      candidates.push({
        path: resolve(directory, configPath),
        source: directory === resolvedCwd ? "cwd" : "cwd-ancestor"
      });
    }
  } else {
    candidates.push({ path: resolve(resolvedCwd, configPath), source: "cwd" });
    candidates.push({ path: resolve(resolvedWorkdir, configPath), source: "workdir" });
  }

  const uniqueCandidates: typeof candidates = [];
  const seenPaths = new Set<string>();
  for (const candidate of candidates) {
    if (!seenPaths.has(candidate.path)) {
      uniqueCandidates.push(candidate);
      seenPaths.add(candidate.path);
    }
  }

  for (const candidate of uniqueCandidates) {
    if (existsSync(candidate.path)) {
      return {
        path: candidate.path,
        searched: uniqueCandidates.map((entry) => entry.path),
        source: candidate.source
      };
    }
  }

  return {
    path: uniqueCandidates[0]?.path ?? resolve(resolvedWorkdir, configPath),
    searched: uniqueCandidates.map((entry) => entry.path),
    source: "missing"
  };
}

export function formatConfigDiscoveryFailure(result: ConfigDiscoveryResult): string {
  const searchedSummary = result.searched.length > 0
    ? `Searched: ${result.searched.join(", ")}`
    : "No config search paths were generated.";
  return `Config file not found: ${result.path}. ${searchedSummary}`;
}

function ancestorDirectories(start: string): string[] {
  const directories: string[] = [];
  let current = resolve(start);

  while (true) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return directories;
}

function isSimpleFileName(path: string): boolean {
  return !path.includes("/") && !path.includes("\\");
}
