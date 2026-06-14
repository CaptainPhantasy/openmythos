import type { TaskObservation } from "../core/types.js";
import { executeCommand } from "./shell.js";

const IGNORE_GLOBS = ["!node_modules", "!.git", "!dist", "!runs"];
const MAX_MATCH_LINES = 20;
const MAX_CONTENT_CHARS = 4000;

export async function searchRepository(
  workdir: string,
  query: string,
  timeoutMs: number
): Promise<TaskObservation> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return {
      kind: "filesystem.search",
      status: "warning",
      summary: "Skipped empty repository search query.",
      content: "The planner provided an empty context query.",
      nextActions: ["Provide a non-empty fixed-string query before retrying filesystem.search."],
      artifacts: []
    };
  }

  const result = await executeCommand(
    "rg",
    [
      "-n",
      "-F",
      "--hidden",
      "--max-count",
      String(MAX_MATCH_LINES),
      ...IGNORE_GLOBS.flatMap((glob) => ["-g", glob]),
      trimmed,
      "."
    ],
    workdir,
    timeoutMs
  );

  if (result.exitCode === 0) {
    const matchCount = countLines(result.stdout);
    return {
      kind: "filesystem.search",
      status: "success",
      summary: `Found ${matchCount} repository match${matchCount === 1 ? "" : "es"} for "${trimmed}".`,
      content: truncateContent(result.stdout),
      nextActions: ["Use filesystem.read on the matching paths if you need full file context."],
      artifacts: []
    };
  }

  if (result.exitCode === 1) {
    return {
      kind: "filesystem.search",
      status: "warning",
      summary: `No repository matches found for "${trimmed}".`,
      content: "rg returned no matches for the requested fixed-string query.",
      nextActions: ["Refine the query text or try code.symbols for identifier-like targets."],
      artifacts: []
    };
  }

  return {
    kind: "filesystem.search",
    status: "error",
    summary: `Repository search failed for "${trimmed}".`,
    content: truncateContent([result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `rg exited with code ${result.exitCode}.`),
    nextActions: ["Check rg availability and the workdir, then retry the search."],
    artifacts: []
  };
}

export async function findSymbolDefinitions(
  workdir: string,
  query: string,
  timeoutMs: number
): Promise<TaskObservation> {
  const symbol = normalizeSymbolQuery(query);
  if (!symbol) {
    return {
      kind: "code.symbols",
      status: "warning",
      summary: `Skipped non-symbol query "${query}".`,
      content: "Only identifier-like symbol queries are accepted for code.symbols.",
      nextActions: ["Provide an identifier-like query such as a function, class, or constant name."],
      artifacts: []
    };
  }

  const escaped = escapeRegex(symbol);
  const symbolPattern = [
    String.raw`\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+${escaped}\b`,
    String.raw`\b(?:export\s+)?(?:const|let|var)\s+${escaped}\b`,
    String.raw`\b${escaped}\s*[:=].*=>`
  ].join("|");

  const result = await executeCommand(
    "rg",
    [
      "-n",
      "--hidden",
      "--max-count",
      String(MAX_MATCH_LINES),
      ...IGNORE_GLOBS.flatMap((glob) => ["-g", glob]),
      "-e",
      symbolPattern,
      "."
    ],
    workdir,
    timeoutMs
  );

  if (result.exitCode === 0) {
    const matchCount = countLines(result.stdout);
    return {
      kind: "code.symbols",
      status: "success",
      summary: `Found ${matchCount} likely symbol definition${matchCount === 1 ? "" : "s"} for "${symbol}".`,
      content: truncateContent(result.stdout),
      nextActions: ["Use filesystem.read on the matching file if you need surrounding implementation context."],
      artifacts: []
    };
  }

  if (result.exitCode === 1) {
    return {
      kind: "code.symbols",
      status: "warning",
      summary: `No likely symbol definitions found for "${symbol}".`,
      content: "rg did not find matching declaration-like lines for the requested symbol.",
      nextActions: ["Try filesystem.search for call sites or related string matches."],
      artifacts: []
    };
  }

  return {
    kind: "code.symbols",
    status: "error",
    summary: `Symbol lookup failed for "${symbol}".`,
    content: truncateContent([result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `rg exited with code ${result.exitCode}.`),
    nextActions: ["Check rg availability and the query syntax, then retry symbol lookup."],
    artifacts: []
  };
}

function normalizeSymbolQuery(query: string): string | null {
  const trimmed = query.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateContent(content: string): string {
  return content.length <= MAX_CONTENT_CHARS
    ? content
    : `${content.slice(0, MAX_CONTENT_CHARS)}\n...[truncated]`;
}

function countLines(content: string): number {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split("\n").length;
}
