import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMemory, addNote, addDecision, searchMemory, clearMemory } from "../core/memory.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "om-memory-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("memory", () => {
  it("returns empty memory for new repo", async () => {
    await withTempDir(async (dir) => {
      const memory = await loadMemory(dir);
      assert.equal(memory.notes.length, 0);
      assert.equal(memory.decisions.length, 0);
      assert.equal(memory.patterns.length, 0);
    });
  });

  it("adds and retrieves a note", async () => {
    await withTempDir(async (dir) => {
      await addNote(dir, "Use pnpm not npm", ["tooling"]);
      const memory = await loadMemory(dir);
      assert.equal(memory.notes.length, 1);
      assert.equal(memory.notes[0]!.content, "Use pnpm not npm");
      assert.deepEqual(memory.notes[0]!.tags, ["tooling"]);
    });
  });

  it("adds and retrieves a decision", async () => {
    await withTempDir(async (dir) => {
      await addDecision(dir, "Use zod for validation", "Consistent with existing patterns");
      const memory = await loadMemory(dir);
      assert.equal(memory.decisions.length, 1);
      assert.equal(memory.decisions[0]!.decision, "Use zod for validation");
    });
  });

  it("searches notes by content", async () => {
    await withTempDir(async (dir) => {
      await addNote(dir, "pnpm is the package manager");
      await addNote(dir, "use vitest for testing");
      const results = await searchMemory(dir, "pnpm");
      assert.equal(results.notes.length, 1);
      assert.ok(results.notes[0]!.content.includes("pnpm"));
    });
  });

  it("clears all memory", async () => {
    await withTempDir(async (dir) => {
      await addNote(dir, "note 1");
      await addDecision(dir, "decision 1", "reason");
      await clearMemory(dir);
      const memory = await loadMemory(dir);
      assert.equal(memory.notes.length, 0);
      assert.equal(memory.decisions.length, 0);
    });
  });
});
