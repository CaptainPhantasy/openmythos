import type { OpenMythosConfig } from "../config/schema.js";
import { listTextFiles, readRelativeFile } from "../tools/files.js";

export interface RawContext {
  manifest: string[];
  files: Record<string, string>;
}

interface ScoredFile {
  relativePath: string;
  content: string;
  score: number;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "no",
  "not",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "use",
  "with",
  "your"
]);

export async function gatherContext(
  workdir: string,
  config: OpenMythosConfig["context"],
  relevantPatterns: string[],
  query = ""
): Promise<RawContext> {
  const listed = await listTextFiles(
    workdir,
    config.ignorePatterns,
    config.ignoreExtensions,
    config.maxFileSizeBytes,
    config.maxFiles * 2
  );

  const queryTerms = extractQueryTerms(query);
  const scored: ScoredFile[] = [];

  for (const file of listed) {
    const content = await readRelativeFile(workdir, file.relativePath);
    scored.push({
      relativePath: file.relativePath,
      content,
      score: scoreFile(file.relativePath, content, relevantPatterns, queryTerms)
    });
  }

  const selected = scored
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
    .slice(0, config.maxFiles);

  const files: Record<string, string> = {};
  for (const file of selected) {
    files[file.relativePath] = extractRelevantSnippet(file.content, queryTerms);
  }

  return {
    manifest: selected.map((file) => file.relativePath),
    files
  };
}

function scoreFile(path: string, content: string, patterns: string[], queryTerms: string[]): number {
  let score = 0;

  if (patterns.some((pattern) => matchGlob(path, pattern))) {
    score += 100;
  }

  const pathTerms = tokenize(path.replace(/[./_-]/g, " "));
  for (const term of queryTerms) {
    if (pathTerms.includes(term)) {
      score += 15;
    }
  }

  const lower = content.toLowerCase();
  for (const term of queryTerms) {
    const matches = lower.match(new RegExp(`\\b${escapeRegExp(term)}\\b`, "g"));
    if (matches) {
      score += Math.min(matches.length, 5) * 6;
    }
  }

  const symbols = extractSymbols(content);
  for (const symbol of symbols) {
    const symbolTerms = tokenize(symbol);
    if (symbolTerms.some((term) => queryTerms.includes(term))) {
      score += 10;
    }
  }

  return score;
}

export function extractRelevantSnippet(content: string, queryTerms: string[]): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (queryTerms.length === 0) {
    return lines.slice(0, 40).join("\n").trim();
  }

  const windows: Array<{ start: number; end: number; score: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.toLowerCase() ?? "";
    let hits = 0;
    for (const term of queryTerms) {
      if (line.includes(term)) {
        hits += 1;
      }
    }
    if (hits > 0) {
      windows.push({
        start: Math.max(0, index - 3),
        end: Math.min(lines.length, index + 4),
        score: hits
      });
    }
  }

  if (windows.length === 0) {
    return lines.slice(0, 40).join("\n").trim();
  }

  windows.sort((a, b) => b.score - a.score || a.start - b.start);
  const selected = windows.slice(0, 3).sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const window of selected) {
    const previous = merged[merged.length - 1];
    if (previous && window.start <= previous.end) {
      previous.end = Math.max(previous.end, window.end);
      continue;
    }
    merged.push({ start: window.start, end: window.end });
  }

  return merged
    .map((window) => lines.slice(window.start, window.end).join("\n").trim())
    .filter((block) => block.length > 0)
    .join("\n...\n");
}

function extractQueryTerms(query: string): string[] {
  return tokenize(query).filter((term) => !STOP_WORDS.has(term));
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2);
}

function extractSymbols(content: string): string[] {
  const matches = content.matchAll(/\b(?:class|function|interface|type|const|let|var|enum)\s+([A-Za-z0-9_]+)/g);
  const symbols: string[] = [];
  for (const match of matches) {
    const symbol = match[1];
    if (symbol) {
      symbols.push(symbol);
    }
  }
  return symbols;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
