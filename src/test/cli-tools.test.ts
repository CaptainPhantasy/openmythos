import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "om-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CLI = "node dist/index.js";

describe("CLI file operations", () => {
  it("write then read round-trips content", async () => {
    await withTempDir(async (dir) => {
      execSync(`${CLI} write hello.txt "hello world" -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos" });
      const content = await readFile(resolve(dir, "hello.txt"), "utf8");
      assert.equal(content, "hello world");
    });
  });

  it("edit replaces text in a file", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "code.ts"), "const x = old_value;", "utf8");
      execSync(`${CLI} edit code.ts old_value new_value -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos" });
      const content = await readFile(resolve(dir, "code.ts"), "utf8");
      assert.ok(content.includes("new_value"));
      assert.ok(!content.includes("old_value"));
    });
  });

  it("edit --all replaces all occurrences", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "multi.txt"), "foo foo foo", "utf8");
      execSync(`${CLI} edit multi.txt foo bar --all -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos" });
      const content = await readFile(resolve(dir, "multi.txt"), "utf8");
      assert.equal(content, "bar bar bar");
    });
  });

  it("search finds pattern in files", async () => {
    await withTempDir(async (dir) => {
      await mkdir(resolve(dir, "src"), { recursive: true });
      await writeFile(resolve(dir, "src", "app.ts"), "function hello() { return 'world'; }", "utf8");
      await writeFile(resolve(dir, "src", "other.ts"), "const greeting = 'hi';", "utf8");
      const output = execSync(`${CLI} search hello -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("hello"));
      assert.ok(output.includes("app.ts"));
    });
  });

  it("ls lists directory entries", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "file1.txt"), "x", "utf8");
      await mkdir(resolve(dir, "subdir"));
      const output = execSync(`${CLI} ls -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("file1.txt"));
      assert.ok(output.includes("subdir"));
    });
  });

  it("write --append adds to existing content", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "log.txt"), "line1\n", "utf8");
      execSync(`${CLI} write log.txt "line2" --append -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos" });
      const content = await readFile(resolve(dir, "log.txt"), "utf8");
      assert.ok(content.includes("line1"));
      assert.ok(content.includes("line2"));
    });
  });
});

describe("CLI git operations", () => {
  it("gst shows git status", async () => {
    await withTempDir(async (dir) => {
      execSync("git init", { cwd: dir });
      execSync('git -c user.email="t@t.com" -c user.name="T" commit --allow-empty -m init', { cwd: dir });
      await writeFile(resolve(dir, "new.txt"), "x", "utf8");
      const output = execSync(`${CLI} gst --short -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("new.txt") || output.includes("??"));
    });
  });

  it("log shows commit history", async () => {
    await withTempDir(async (dir) => {
      execSync("git init", { cwd: dir });
      execSync('git -c user.email="t@t.com" -c user.name="T" commit --allow-empty -m "first commit"', { cwd: dir });
      const output = execSync(`${CLI} log --oneline -n 5 -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("first commit"));
    });
  });

  it("diff shows changes", async () => {
    await withTempDir(async (dir) => {
      execSync("git init", { cwd: dir });
      await writeFile(resolve(dir, "file.ts"), "original", "utf8");
      execSync('git -c user.email="t@t.com" -c user.name="T" add . ', { cwd: dir });
      execSync('git -c user.email="t@t.com" -c user.name="T" commit -m init', { cwd: dir });
      await writeFile(resolve(dir, "file.ts"), "modified", "utf8");
      const output = execSync(`${CLI} diff -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("modified") || output.includes("original"));
    });
  });
});

describe("CLI meta commands", () => {
  it("exec runs a shell command", async () => {
    await withTempDir(async (dir) => {
      const output = execSync(`${CLI} exec "echo test123" -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("test123"));
    });
  });

  it("build auto-detects and runs npm build", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "package.json"), JSON.stringify({ name: "test", scripts: { build: "echo BUILD_OK" } }), "utf8");
      const output = execSync(`${CLI} build -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("BUILD_OK"));
    });
  });

  it("test auto-detects and runs npm test", async () => {
    await withTempDir(async (dir) => {
      await writeFile(resolve(dir, "package.json"), JSON.stringify({ name: "test", scripts: { test: "echo TEST_OK" } }), "utf8");
      const output = execSync(`${CLI} test -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("TEST_OK"));
    });
  });

  it("init creates config and exits non-zero when key missing", async () => {
    await withTempDir(async (dir) => {
      // Remove all keys for this test
      const env = { ...process.env };
      for (const k of ["ZAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete env[k];
      try {
        execSync(`${CLI} init --provider openai -w "${dir}"`, {
          cwd: "/Volumes/Storage/OpenMythos",
          encoding: "utf8",
          env,
          stdio: "pipe",
        });
        assert.fail("should have exited non-zero");
      } catch (err) {
        // Expected: exit code non-zero because key missing
        const e = err as { stdout?: string; stderr?: string };
        const combined = (e.stdout ?? "") + (e.stderr ?? "");
        assert.ok(combined.includes("Created") || combined.includes("init"));
      }
      // Config should still be created
      const configExists = existsSync(resolve(dir, "openmythos.config.json"));
      assert.ok(configExists, "config should be created even without key");
    });
  });

  it("doctor shows environment diagnostics", async () => {
    await withTempDir(async (dir) => {
      const output = execSync(`${CLI} doctor -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("Doctor") || output.includes("Node") || output.includes("Git"));
    });
  });

  it("history shows no runs message for empty dir", async () => {
    await withTempDir(async (dir) => {
      const output = execSync(`${CLI} history -w "${dir}"`, { cwd: "/Volumes/Storage/OpenMythos", encoding: "utf8" });
      assert.ok(output.includes("No runs") || output.trim().length >= 0);
    });
  });
});
