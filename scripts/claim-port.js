#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

const forbiddenPorts = new Set([3000, 5173]);
const projectRoot = process.cwd();
const claimsDir = `${projectRoot}/.supercache/ports`;
const claimsFile = `${claimsDir}/claims.json`;
const claimsLog = `${claimsDir}/claims.log`;

const portArg = process.argv[2];
if (!portArg) {
  console.error("Usage: node scripts/claim-port.js <port>");
  process.exit(1);
}

const port = Number(portArg);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  logClaim(portArg, "reject", "invalid port");
  console.error(`Invalid port: ${portArg}`);
  process.exit(2);
}

if (forbiddenPorts.has(port)) {
  logClaim(port, "reject", "forbidden by workspace policy");
  console.error(`Port ${port} is forbidden by workspace policy.`);
  process.exit(3);
}

const hasPort = isPortInUse(port);
if (hasPort.inUse) {
  logClaim(port, "reject", hasPort.reason);
  console.error(`Port ${port} is already in use: ${hasPort.reason}`);
  process.exit(4);
}

const payload = loadClaims();
if (!payload.claims.some((claim) => claim.port === port && claim.status === "active")) {
  payload.claims.push({
    port,
    status: "active",
    claimedAt: new Date().toISOString(),
    actor: process.env.USER || "unknown",
    source: basename(process.argv[1] || "claim-port.js"),
    workdir: projectRoot,
  });
}

ensurePortsDir();
writeFileSync(claimsFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf-8" });
logClaim(port, "claim", "reserved for local binding");
console.log(`Port ${port} claimed successfully.`);

function isPortInUse(portToCheck) {
  const result = spawnSync("lsof", ["-nP", "-iTCP", `:${portToCheck}`, "-sTCP:LISTEN"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    return { inUse: false, reason: "skip-binding-check(lsof unavailable)" };
  }

  if (!result.stdout) {
    return { inUse: false, reason: "available" };
  }

  if (result.status === 0 && result.stdout.includes(`:${portToCheck}`)) {
    const firstLine = result.stdout
      .split("\n")
      .filter((line) => line.trim())
      .slice(1)[0]?.trim() || "in use";
    return { inUse: true, reason: firstLine || "in use" };
  }

  return { inUse: false, reason: "available" };
}

function ensurePortsDir() {
  mkdirSync(claimsDir, { recursive: true });
}

function loadClaims() {
  const defaultPayload = {
    project: "openmythos",
    generatedAt: new Date().toISOString(),
    forbiddenPorts: Array.from(forbiddenPorts).sort((a, b) => a - b),
    claims: [],
  };

  if (!existsSync(claimsFile)) {
    return defaultPayload;
  }

  try {
    const raw = readFileSync(claimsFile, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultPayload,
      ...parsed,
      claims: Array.isArray(parsed?.claims) ? parsed.claims : [],
      forbiddenPorts: Array.isArray(parsed?.forbiddenPorts)
        ? parsed.forbiddenPorts
        : defaultPayload.forbiddenPorts,
    };
  } catch {
    return defaultPayload;
  }
}

function logClaim(portValue, action, reason) {
  ensurePortsDir();
  const row = `${new Date().toISOString()} | ${action} | ${portValue} | ${reason} | ${process.env.USER || "unknown"}`;
  if (existsSync(claimsLog)) {
    writeFileSync(claimsLog, `\n${row}`, { encoding: "utf-8", flag: "a" });
  } else {
    writeFileSync(claimsLog, `${row}\n`, { encoding: "utf-8" });
  }
}
