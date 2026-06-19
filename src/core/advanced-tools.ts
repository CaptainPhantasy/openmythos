import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, readdir, copyFile, lstat as fsStat, rm } from "node:fs/promises";
import { resolve, join, relative, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// ============================================================
// SNAPSHOT / RESTORE — checkpoint workdir state for instant undo
// ============================================================

export interface Snapshot {
  id: string;
  path: string;
  createdAt: string;
  workdir: string;
  fileCount: number;
}

export async function createSnapshot(workdir: string, label?: string): Promise<Snapshot> {
  const snapshotDir = resolve(workdir, ".openmythos", "snapshots");
  const id = label ?? `snap-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const snapPath = resolve(snapshotDir, id);
  await mkdir(snapPath, { recursive: true });

  const skip = new Set(["node_modules", ".git", "dist", "build", ".openmythos", "runs", ".supercache", ".quarantine"]);
  let fileCount = 0;

  async function copyDir(src: string, dst: string): Promise<void> {
    const entries = await readdir(src);
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const srcPath = join(src, entry);
      const dstPath = join(dst, entry);
      const entryStat = await fsStat(srcPath);
      if (entryStat.isDirectory()) {
        await mkdir(dstPath, { recursive: true });
        await copyDir(srcPath, dstPath);
      } else if (entryStat.isFile()) {
        await copyFile(srcPath, dstPath);
        fileCount++;
      }
      // Skip sockets, FIFOs, device files, symlinks — they can't be copied safely.
    }
  }

  await copyDir(workdir, snapPath);
  const meta: Snapshot = { id, path: snapPath, createdAt: new Date().toISOString(), workdir, fileCount };
  await writeFile(resolve(snapPath, ".snapshot-meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export async function restoreSnapshot(workdir: string, snapshotId: string): Promise<Snapshot> {
  const snapPath = resolve(workdir, ".openmythos", "snapshots", snapshotId);
  if (!existsSync(resolve(snapPath, ".snapshot-meta.json"))) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  const meta = JSON.parse(await readFile(resolve(snapPath, ".snapshot-meta.json"), "utf8")) as Snapshot;

  const skip = new Set([".openmythos", "runs"]);
  async function restoreDir(src: string, dst: string): Promise<void> {
    const entries = await readdir(src);
    for (const entry of entries) {
      if (entry === ".snapshot-meta.json") continue;
      if (skip.has(entry)) continue;
      const srcPath = join(src, entry);
      const dstPath = join(dst, entry);
      const entryStat = await fsStat(srcPath);
      if (entryStat.isDirectory()) {
        await mkdir(dstPath, { recursive: true });
        await restoreDir(srcPath, dstPath);
      } else if (entryStat.isFile()) {
        await copyFile(srcPath, dstPath);
      }
    }
  }
  await restoreDir(snapPath, workdir);
  return meta;
}

export async function listSnapshots(workdir: string): Promise<Snapshot[]> {
  const snapshotDir = resolve(workdir, ".openmythos", "snapshots");
  if (!existsSync(snapshotDir)) return [];
  const entries = await readdir(snapshotDir);
  const snapshots: Snapshot[] = [];
  for (const entry of entries) {
    const metaPath = resolve(snapshotDir, entry, ".snapshot-meta.json");
    if (existsSync(metaPath)) {
      try {
        snapshots.push(JSON.parse(await readFile(metaPath, "utf8")));
      } catch { /* skip */ }
    }
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ============================================================
// BATCH — atomic multi-file edits from a JSON manifest
// ============================================================

export interface BatchEdit {
  file: string;
  find?: string;
  replace?: string;
  content?: string;
  action: "replace" | "write" | "delete";
}

export interface BatchResult {
  applied: number;
  skipped: number;
  errors: string[];
  changes: Array<{ file: string; action: string; linesChanged: number }>;
}

export async function applyBatch(workdir: string, edits: BatchEdit[]): Promise<BatchResult> {
  const result: BatchResult = { applied: 0, skipped: 0, errors: [], changes: [] };

  // Validate all edits first — fail atomically if any are invalid
  for (const edit of edits) {
    if (!edit.file) {
      result.errors.push(`Edit missing 'file' field`);
      return result;
    }
    if (edit.action === "replace" && (!edit.find || edit.replace === undefined)) {
      result.errors.push(`Replace edit for ${edit.file} missing 'find' or 'replace'`);
      return result;
    }
  }
  if (result.errors.length > 0) return result;

  // Apply all edits
  for (const edit of edits) {
    const absPath = resolve(workdir, edit.file);
    try {
      if (edit.action === "delete") {
        if (existsSync(absPath)) {
          await rm(absPath);
          result.applied++;
          result.changes.push({ file: edit.file, action: "delete", linesChanged: 0 });
        } else {
          result.skipped++;
        }
      } else if (edit.action === "write" && edit.content !== undefined) {
        await mkdir(resolve(absPath, ".."), { recursive: true });
        await writeFile(absPath, edit.content, "utf8");
        result.applied++;
        result.changes.push({ file: edit.file, action: "write", linesChanged: edit.content.split("\n").length });
      } else if (edit.action === "replace" && edit.find && edit.replace !== undefined) {
        if (!existsSync(absPath)) {
          result.errors.push(`File not found for replace: ${edit.file}`);
          result.skipped++;
          continue;
        }
        const content = await readFile(absPath, "utf8");
        const occurrences = content.split(edit.find).length - 1;
        if (occurrences === 0) {
          result.skipped++;
          continue;
        }
        const updated = content.split(edit.find).join(edit.replace);
        await writeFile(absPath, updated, "utf8");
        result.applied++;
        result.changes.push({ file: edit.file, action: "replace", linesChanged: occurrences });
      }
    } catch (error) {
      result.errors.push(`${edit.file}: ${(error as Error).message}`);
    }
  }

  return result;
}

// ============================================================
// IMPACT — dependency blast-radius analysis
// ============================================================

export interface ImpactResult {
  symbol: string;
  files: Array<{ file: string; matches: number; lines: number[] }>;
  totalMatches: number;
}

export async function analyzeImpact(workdir: string, symbol: string): Promise<ImpactResult> {
  const skip = new Set(["node_modules", ".git", "dist", "build", ".openmythos", "runs", ".supercache", ".quarantine"]);
  const exts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php", ".c", ".cpp", ".h"]);
  const files: Array<{ file: string; matches: number; lines: number[] }> = [];
  let totalMatches = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 10) return;
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const fullPath = join(dir, entry);
      let entryStat;
      try { entryStat = await fsStat(fullPath); } catch { continue; }
      if (entryStat.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entryStat.isFile()) {
        const ext = entry.substring(entry.lastIndexOf("."));
        if (!exts.has(ext)) continue;
        try {
          const content = await readFile(fullPath, "utf8");
          if (content.length > 500000) continue;
          const lines = content.split("\n");
          const matchLines: number[] = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes(symbol)) matchLines.push(i + 1);
          }
          if (matchLines.length > 0) {
            files.push({ file: relative(workdir, fullPath), matches: matchLines.length, lines: matchLines.slice(0, 20) });
            totalMatches += matchLines.length;
          }
        } catch { /* skip */ }
      }
    }
  }

  await walk(workdir, 0);
  return { symbol, files: files.sort((a, b) => b.matches - a.matches), totalMatches };
}

// ============================================================
// COST — aggregate token usage from run metrics
// ============================================================

export interface CostReport {
  runs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostCents: number;
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
}

export async function aggregateCost(workdir: string): Promise<CostReport> {
  const runsDir = resolve(workdir, "runs");
  const report: CostReport = {
    runs: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    estimatedCostCents: 0,
    byModel: {},
  };

  if (!existsSync(runsDir)) return report;

  const entries = await readdir(runsDir);
  for (const entry of entries) {
    const metricsPath = resolve(runsDir, entry, "metrics.json");
    if (!existsSync(metricsPath)) continue;
    try {
      const metrics = JSON.parse(await readFile(metricsPath, "utf8")) as {
        modelUsage?: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number }>;
      };
      report.runs++;
      for (const usage of metrics.modelUsage ?? []) {
        report.totalInputTokens += usage.inputTokens ?? 0;
        report.totalOutputTokens += usage.outputTokens ?? 0;
        const model = usage.model ?? "unknown";
        if (!report.byModel[model]) {
          report.byModel[model] = { calls: 0, inputTokens: 0, outputTokens: 0 };
        }
        report.byModel[model]!.calls += usage.calls ?? 0;
        report.byModel[model]!.inputTokens += usage.inputTokens ?? 0;
        report.byModel[model]!.outputTokens += usage.outputTokens ?? 0;
      }
    } catch { /* skip */ }
  }

  report.totalTokens = report.totalInputTokens + report.totalOutputTokens;
  // Rough cost estimate: $3/M input, $15/M output (typical frontier model rates)
  report.estimatedCostCents = Math.round(
    (report.totalInputTokens * 0.3 + report.totalOutputTokens * 1.5) / 1000
  );
  return report;
}

// ============================================================
// APPLY PATCH — apply unified diff with automatic backup
// ============================================================

export async function applyPatch(workdir: string, patchPath: string): Promise<{ applied: boolean; backupPath: string }> {
  const absPatch = resolve(workdir, patchPath);
  if (!existsSync(absPatch)) throw new Error(`Patch file not found: ${patchPath}`);

  // Create backup snapshot before applying
  const backup = await createSnapshot(workdir, `pre-patch-${Date.now()}`);

  try {
    execFileSync("git", ["apply", absPatch], { cwd: workdir, timeout: 30000 });
    return { applied: true, backupPath: backup.path };
  } catch {
    // If git apply fails, try patch command
    try {
      execFileSync("patch", ["-p1", "--input", absPatch], { cwd: workdir, timeout: 30000 });
      return { applied: true, backupPath: backup.path };
    } catch (error) {
      throw new Error(`Patch failed to apply: ${(error as Error).message}. Backup at ${backup.path}`);
    }
  }
}
