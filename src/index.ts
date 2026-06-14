#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { buildCli } from "./ui/cli.js";

loadEnv();

await buildCli().parseAsync(process.argv);
