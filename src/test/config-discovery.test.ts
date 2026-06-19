import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { discoverConfigPath } from "../config/discovery.js";

test("discoverConfigPath walks workdir ancestors for the default config filename", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmythos-config-discovery-"));
  const nestedWorkdir = resolve(root, "apps/demo");
  await mkdir(nestedWorkdir, { recursive: true });
  await writeFile(resolve(root, "openmythos.config.json"), "{\"models\":{}}", "utf8");

  const result = discoverConfigPath("openmythos.config.json", nestedWorkdir, "/");

  assert.equal(result.path, resolve(root, "openmythos.config.json"));
  assert.equal(result.source, "workdir-ancestor");
  assert.ok(result.searched.includes(resolve(root, "openmythos.config.json")));
});

test("CLI run discovers config from a workdir ancestor when launched outside the repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmythos-cli-config-"));
  const workdir = resolve(root, "packages/service");
  await mkdir(resolve(root, "profiles"), { recursive: true });
  await mkdir(workdir, { recursive: true });

  await writeFile(
    resolve(root, "openmythos.config.json"),
    await readFile(resolve(process.cwd(), "openmythos.config.json"), "utf8"),
    "utf8"
  );
  await writeFile(
    resolve(root, "profiles/fake.json"),
    await readFile(resolve(process.cwd(), "profiles/fake.json"), "utf8"),
    "utf8"
  );

  const stdout = execFileSync(
    "node",
    [resolve(process.cwd(), "dist/index.js"), "run", "--profile", "fake", "--workdir", workdir, "noop"],
    {
      cwd: "/",
      encoding: "utf8"
    }
  );

  const payload = JSON.parse(stdout) as { status?: string };
  assert.equal(payload.status, "completed");
  await access(resolve(workdir, "openmythos-fake-output.txt"));
});
