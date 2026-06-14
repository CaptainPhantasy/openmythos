import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import type { FileEdit } from "../core/types.js";

export async function applyFileEdits(workdir: string, edits: FileEdit[], archiveDir: string): Promise<void> {
  const root = resolve(workdir);
  const archiveRoot = resolve(archiveDir);
  for (const edit of edits) {
    const target = resolve(root, edit.path);
    if (!isInside(root, target)) {
      throw new Error(`Refusing file edit outside workdir: ${edit.path}`);
    }

    if (edit.action === "delete") {
      if (existsSync(target)) {
        const archived = resolve(archiveRoot, "deleted-files", edit.path);
        await mkdir(dirname(archived), { recursive: true });
        await rename(target, archived);
      }
      continue;
    }

    if (edit.action === "patch") {
      if (!existsSync(target)) {
        throw new Error(`Refusing patch edit for missing file: ${edit.path}`);
      }
      const current = await readFile(target, "utf8");
      const next = applyUnifiedPatch(current, normalizeUnifiedPatch(edit.path, edit.content));
      await writeFile(target, next);
      continue;
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, edit.content);
  }
}

export interface ListedFile {
  relativePath: string;
  size: number;
}

export async function listTextFiles(
  rootDir: string,
  ignoreNames: string[],
  ignoreExtensions: string[],
  maxFileSize: number,
  maxFiles: number
): Promise<ListedFile[]> {
  const root = resolve(rootDir);
  const files: ListedFile[] = [];
  const ignoredNames = new Set(ignoreNames);
  const ignoredExts = new Set(ignoreExtensions);

  async function walk(dir: string): Promise<void> {
    if (files.length >= maxFiles) {
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        return;
      }
      if (ignoredNames.has(entry.name)) {
        continue;
      }
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (ignoredExts.has(extname(entry.name))) {
        continue;
      }
      const info = await stat(path);
      if (info.size > maxFileSize) {
        continue;
      }
      files.push({ relativePath: relative(root, path), size: info.size });
    }
  }

  await walk(root);
  return files;
}

export async function readRelativeFile(rootDir: string, relativePath: string): Promise<string> {
  const root = resolve(rootDir);
  const path = resolve(root, relativePath);
  if (!isInside(root, path)) {
    throw new Error(`Refusing file read outside workdir: ${relativePath}`);
  }
  return readFile(path, "utf8");
}

export function normalizeUnifiedPatch(path: string, patch: string): string {
  const trimmed = patch.trim();
  if (trimmed.startsWith("diff --git") || trimmed.startsWith("--- ") || trimmed.startsWith("@@")) {
    if (trimmed.startsWith("@@")) {
      return [
        `--- a/${path}`,
        `+++ b/${path}`,
        trimmed
      ].join("\n");
    }
    return trimmed;
  }
  throw new Error(`Patch content for ${path} is not a valid unified diff.`);
}

export function applyUnifiedPatch(original: string, patch: string): string {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const hunks = parsePatchHunks(lines);
  const originalLines = splitLines(original);
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const targetIndex = Math.max(0, hunk.oldStart - 1);
    while (cursor < targetIndex && cursor < originalLines.length) {
      output.push(originalLines[cursor] ?? "");
      cursor += 1;
    }

    for (const part of hunk.parts) {
      if (part.type === "context") {
        expectLine(originalLines[cursor], part.value, hunk.header);
        output.push(part.value);
        cursor += 1;
        continue;
      }
      if (part.type === "remove") {
        expectLine(originalLines[cursor], part.value, hunk.header);
        cursor += 1;
        continue;
      }
      output.push(part.value);
    }
  }

  while (cursor < originalLines.length) {
    output.push(originalLines[cursor] ?? "");
    cursor += 1;
  }

  return original.endsWith("\n") || output.length === 0 ? `${output.join("\n")}\n`.replace(/^\n$/, "") : output.join("\n");
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}/`);
}

interface ParsedHunk {
  header: string;
  oldStart: number;
  parts: Array<{ type: "context" | "remove" | "add"; value: string }>;
}

function parsePatchHunks(lines: string[]): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.startsWith("@@")) {
      index += 1;
      continue;
    }

    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (!match) {
      throw new Error(`Invalid patch hunk header: ${line}`);
    }

    const hunk: ParsedHunk = {
      header: line,
      oldStart: Number.parseInt(match[1] ?? "1", 10),
      parts: []
    };
    index += 1;

    while (index < lines.length) {
      const part = lines[index] ?? "";
      if (part.startsWith("@@")) {
        break;
      }
      if (part.startsWith("--- ") || part.startsWith("+++ ") || part.startsWith("diff --git")) {
        break;
      }
      if (part === "\\ No newline at end of file") {
        index += 1;
        continue;
      }

      const prefix = part[0];
      const value = part.slice(1);
      if (prefix === " ") {
        hunk.parts.push({ type: "context", value });
      } else if (prefix === "-") {
        hunk.parts.push({ type: "remove", value });
      } else if (prefix === "+") {
        hunk.parts.push({ type: "add", value });
      } else if (part.length === 0) {
        hunk.parts.push({ type: "context", value: "" });
      } else {
        throw new Error(`Invalid patch line: ${part}`);
      }
      index += 1;
    }

    hunks.push(hunk);
  }

  if (hunks.length === 0) {
    throw new Error("Unified diff did not contain any hunks.");
  }
  return hunks;
}

function expectLine(actual: string | undefined, expected: string, header: string): void {
  if (actual !== expected) {
    throw new Error(`Patch did not match target file at ${header}. Expected "${expected}" but found "${actual ?? "<eof>"}".`);
  }
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  if (parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}
