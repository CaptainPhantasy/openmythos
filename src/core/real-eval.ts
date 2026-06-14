import { existsSync } from "node:fs";
import { cp, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { OpenMythosConfig } from "../config/schema.js";
import { executeCommand, executeShell, type ShellResult } from "../tools/shell.js";

const realEvalFixtureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  goal: z.string().min(1),
  verificationCommands: z.array(z.string().min(1)).min(1),
  expectedChangedFiles: z.array(z.string().min(1)).min(1),
  prohibitedArtifacts: z.array(z.string().min(1)).default([])
});

export type RealEvalFixture = z.infer<typeof realEvalFixtureSchema>;

const realEvalSuiteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  fixtures: z.array(z.object({
    id: z.string().min(1),
    rounds: z.number().int().min(1).default(1),
    goal: z.string().min(1).optional()
  })).min(1)
});

export type RealEvalSuite = z.infer<typeof realEvalSuiteSchema>;
export interface RealEvalSuiteFixture {
  id: string;
  rounds: number;
  goal?: string;
}

export interface RealEvalAssessment {
  passed: boolean;
  verificationResults: ShellResult[];
  changedFiles: string[];
  expectedChangedFilesSatisfied: boolean;
  prohibitedArtifactsDetected: string[];
  failures: string[];
}

export interface RealEvalModelBinding {
  role: string;
  adapter: string;
  model: string;
  endpoint: string;
  apiKeyEnv?: string | undefined;
}

export interface RealEvalRoundResult {
  round: number;
  status: string;
  runId?: string;
  runDir?: string;
  repoDir: string;
  changedFiles: string[];
  passed: boolean;
  expectedChangedFilesSatisfied: boolean;
  prohibitedArtifactsDetected: string[];
  verificationResults: Array<{ command: string; exitCode: number; durationMs: number }>;
  failures: string[];
  diffStat?: string;
  runArtifacts?: string[];
  error?: string;
}

export interface RealEvalResult {
  goal: string;
  passed: boolean;
  rounds: RealEvalRoundResult[];
  successfulConsecutiveRounds: number;
  modelBindings: RealEvalModelBinding[];
}

export function realEvalFixtureRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/real-eval");
}

export function realEvalSuiteRoot(): string {
  return resolve(realEvalFixtureRoot(), "suites");
}

export async function loadRealEvalFixture(fixtureId: string): Promise<RealEvalFixture> {
  const manifestPath = resolve(realEvalFixtureRoot(), fixtureId, "manifest.json");
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  return realEvalFixtureSchema.parse(raw);
}

export async function loadRealEvalSuite(suiteId: string): Promise<RealEvalSuite> {
  const suitePath = resolve(realEvalSuiteRoot(), `${suiteId}.json`);
  const raw = JSON.parse(await readFile(suitePath, "utf8")) as unknown;
  const parsed = realEvalSuiteSchema.parse(raw);
  return parsed;
}

export async function copyRealEvalFixture(fixtureId: string, destinationRepoDir: string, configTemplatePath?: string): Promise<RealEvalFixture> {
  const fixture = await loadRealEvalFixture(fixtureId);
  const sourceRepoDir = resolve(realEvalFixtureRoot(), fixtureId, "repo");
  if (!existsSync(sourceRepoDir)) {
    throw new Error(`Real eval fixture repo not found: ${sourceRepoDir}`);
  }
  await mkdir(destinationRepoDir, { recursive: true });
  await cp(sourceRepoDir, destinationRepoDir, { recursive: true });

  if (configTemplatePath && configTemplatePath.trim().length > 0) {
    const configPath = resolve(configTemplatePath);
    if (existsSync(configPath)) {
      await cp(configPath, resolve(destinationRepoDir, "openmythos.config.json"), { force: false });
    }
  }

  return fixture;
}

export async function initializeRealEvalRepository(repoDir: string, timeoutMs: number): Promise<void> {
  const init = await executeCommand("git", ["init", "-b", "main"], repoDir, timeoutMs);
  if (init.exitCode !== 0) {
    throw new Error(`Failed to initialize real eval repository: ${init.stderr || init.stdout}`);
  }
  for (const args of [
    ["config", "user.name", "OpenMythos Fixture"],
    ["config", "user.email", "fixture@openmythos.local"],
    ["add", "."],
    ["commit", "-m", "fixture baseline"]
  ]) {
    const result = await executeCommand("git", args, repoDir, timeoutMs);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to prepare real eval repository with git ${args.join(" ")}: ${result.stderr || result.stdout}`);
    }
  }
}

export function usesFakeAdapter(config: OpenMythosConfig): boolean {
  return Object.values(config.models).some((model) => model.adapter === "fake");
}

export async function assessRealEvalFixture(
  fixture: RealEvalFixture,
  repoDir: string,
  timeoutMs: number
): Promise<RealEvalAssessment> {
  const verificationResults: ShellResult[] = [];
  for (const command of fixture.verificationCommands) {
    verificationResults.push(await executeShell(command, repoDir, timeoutMs));
  }

  const status = await executeCommand("git", ["status", "--short"], repoDir, timeoutMs);
  if (status.exitCode !== 0) {
    throw new Error(`Failed to inspect real eval repository status: ${status.stderr || status.stdout}`);
  }

  const changedFiles = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return parts.slice(1).join(" ");
    })
    .filter(Boolean);

  const expectedChangedFilesSatisfied = fixture.expectedChangedFiles.every((path) => changedFiles.includes(path));
  const prohibitedArtifactsDetected = fixture.prohibitedArtifacts.filter((path) => existsSync(resolve(repoDir, path)));
  const failures: string[] = [];

  for (const result of verificationResults) {
    if (result.exitCode !== 0) {
      failures.push(`Verification command failed: ${result.command}`);
    }
  }
  if (!expectedChangedFilesSatisfied) {
    failures.push(`Expected changed files missing: ${fixture.expectedChangedFiles.join(", ")}`);
  }
  if (prohibitedArtifactsDetected.length > 0) {
    failures.push(`Prohibited artifacts detected: ${prohibitedArtifactsDetected.join(", ")}`);
  }

  return {
    passed: failures.length === 0,
    verificationResults,
    changedFiles,
    expectedChangedFilesSatisfied,
    prohibitedArtifactsDetected,
    failures
  };
}

export function snapshotModelBindings(config: OpenMythosConfig): RealEvalModelBinding[] {
  return Object.entries(config.models).map(([role, model]) => ({
    role,
    adapter: model.adapter,
    model: model.model,
    endpoint: model.baseUrl ?? "default provider endpoint",
    apiKeyEnv: model.apiKeyEnv
  }));
}
