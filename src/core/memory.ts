import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface MemoryNote {
  id: string;
  content: string;
  createdAt: string;
  tags: string[];
}

export interface MemoryDecision {
  id: string;
  decision: string;
  rationale: string;
  createdAt: string;
}

export interface MemoryPattern {
  id: string;
  pattern: string;
  description: string;
  occurrences: number;
  lastSeen: string;
}

export interface RepoMemory {
  notes: MemoryNote[];
  decisions: MemoryDecision[];
  patterns: MemoryPattern[];
  lastUpdated: string;
}

const EMPTY_MEMORY: RepoMemory = {
  notes: [],
  decisions: [],
  patterns: [],
  lastUpdated: "",
};

function memoryPath(repoRoot: string): string {
  return resolve(repoRoot, ".openmythos", "memory.json");
}

export async function loadMemory(repoRoot: string): Promise<RepoMemory> {
  const path = memoryPath(repoRoot);
  if (!existsSync(path)) return { notes: [], decisions: [], patterns: [], lastUpdated: "" };
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw);
    return {
      notes: data.notes ?? [],
      decisions: data.decisions ?? [],
      patterns: data.patterns ?? [],
      lastUpdated: data.lastUpdated ?? "",
    };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

export async function saveMemory(repoRoot: string, memory: RepoMemory): Promise<void> {
  const path = memoryPath(repoRoot);
  await mkdir(resolve(repoRoot, ".openmythos"), { recursive: true });
  memory.lastUpdated = new Date().toISOString();
  await writeFile(path, JSON.stringify(memory, null, 2), "utf8");
}

export async function addNote(
  repoRoot: string,
  content: string,
  tags: string[] = []
): Promise<MemoryNote> {
  const memory = await loadMemory(repoRoot);
  const note: MemoryNote = {
    id: randomUUID(),
    content,
    createdAt: new Date().toISOString(),
    tags,
  };
  memory.notes.push(note);
  await saveMemory(repoRoot, memory);
  return note;
}

export async function addDecision(
  repoRoot: string,
  decision: string,
  rationale: string
): Promise<MemoryDecision> {
  const memory = await loadMemory(repoRoot);
  const entry: MemoryDecision = {
    id: randomUUID(),
    decision,
    rationale,
    createdAt: new Date().toISOString(),
  };
  memory.decisions.push(entry);
  await saveMemory(repoRoot, memory);
  return entry;
}

export async function recordPattern(
  repoRoot: string,
  pattern: string,
  description: string
): Promise<MemoryPattern> {
  const memory = await loadMemory(repoRoot);
  const existing = memory.patterns.find((p) => p.pattern === pattern);
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeen = new Date().toISOString();
  } else {
    memory.patterns.push({
      id: randomUUID(),
      pattern,
      description,
      occurrences: 1,
      lastSeen: new Date().toISOString(),
    });
  }
  await saveMemory(repoRoot, memory);
  return memory.patterns.find((p) => p.pattern === pattern)!;
}

export async function searchMemory(repoRoot: string, query: string): Promise<RepoMemory> {
  const memory = await loadMemory(repoRoot);
  const q = query.toLowerCase();
  return {
    notes: memory.notes.filter(
      (n) =>
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
    ),
    decisions: memory.decisions.filter(
      (d) =>
        d.decision.toLowerCase().includes(q) ||
        d.rationale.toLowerCase().includes(q)
    ),
    patterns: memory.patterns.filter(
      (p) =>
        p.pattern.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    ),
    lastUpdated: memory.lastUpdated,
  };
}

export async function clearMemory(repoRoot: string): Promise<void> {
  await saveMemory(repoRoot, { notes: [], decisions: [], patterns: [], lastUpdated: "" });
}
