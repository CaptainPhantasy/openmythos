#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCli } from "./ui/cli.js";

// Load .env from cwd first (project-local overrides).
loadEnv();

// If key env vars are still missing, walk up from the compiled binary location
// to find the repo's .env (so global installs work from any cwd).
const binaryDir = dirname(fileURLToPath(import.meta.url));
let dir = binaryDir;
while (dir && dir !== dirname(dir)) {
  const candidate = resolve(dir, ".env");
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, override: false });
    break;
  }
  dir = dirname(dir);
}

await buildCli().parseAsync(process.argv);
