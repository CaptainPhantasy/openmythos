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

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}/`);
}
