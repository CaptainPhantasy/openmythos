// src/core/notify-park.ts
// Notify-and-park: when a step exhausts all redirects + all replacements,
// the harness writes a STOPPAGE.md to iCloud, then a launchd-driven monitor
// watches for an edit. On edit, the harness reads the user's verbatim response
// and resumes the parked branch.
//
// Q6 invariant: never soldier on. Exhaustion → park ONE branch, ping async,
// keep building everything independent (future: scheduler handles this).

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ParkSignal {
  projectName: string;
  stepId: string;
  stepTitle: string;
  attemptsUsed: number;
  replacementsUsed: number;
  lastFeedback: string;
  parkDir: string;
}

export interface ParkOutcome {
  parked: true;
  stoppageDocPath: string;
  monitorPlistPath: string;
  instructionsForUser: string;
}

const PARK_BASE = "/Users/douglastalley/Library/Mobile Documents/com~apple~CloudDocs/Floyd Docs/BUILD STOPPAGE";
const LAUNCH_AGENT_LABEL = "com.openmythos.park-monitor";

export async function notifyAndPark(signal: ParkSignal): Promise<ParkOutcome> {
  mkdirSync(signal.parkDir, { recursive: true });
  const stoppageDocPath = join(signal.parkDir, "STOPPAGE.md");

  const body = buildStoppageDoc(signal);
  writeFileSync(stoppageDocPath, body);

  const monitorPlistPath = writeMonitorPlist(signal.parkDir, stoppageDocPath);

  return {
    parked: true,
    stoppageDocPath,
    monitorPlistPath,
    instructionsForUser: `Parked. Open ${stoppageDocPath}, edit it with your guidance, save. The monitor resumes the branch within 60s.`,
  };
}

function buildStoppageDoc(s: ParkSignal): string {
  const ts = new Date().toISOString();
  return `# BUILD STOPPAGE — ${s.projectName}

**Parked at:** ${ts}
**Step:** \`${s.stepId}\` — ${s.stepTitle}
**Redirects used:** ${s.attemptsUsed}
**Replacements used:** ${s.replacementsUsed}

## What failed

${s.lastFeedback}

## What I need from you

Edit this file. Below the RESUME marker, write whatever guidance unblocks this step —
a hint, a corrected assumption, an override, a pointer to a file, or "skip" to abandon
the step. Save the file. The OpenMythos monitor will pick up your edit within 60 seconds
and resume the parked branch with your verbatim response.

\`\`\`
RESUME:
\`\`\`
`;
}

/**
 * Write a launchd plist that runs the monitor every 60s, watching STOPPAGE.md for edits.
 * The monitor command writes a sibling file when an edit is detected, which the harness
 * loop (or a future scheduler) polls to resume.
 */
function writeMonitorPlist(parkDir: string, stoppageDocPath: string): string {
  const stampFile = join(parkDir, ".last_mtime");
  const resumeFile = join(parkDir, "RESUME.txt");
  const initialMtime = existsSync(stoppageDocPath) ? statSync(stoppageDocPath).mtimeMs : 0;
  writeFileSync(stampFile, String(initialMtime));

  // The monitor script: compare mtime, on change copy the RESUME block to RESUME.txt.
  const monitorScript = join(parkDir, "monitor.sh");
  writeFileSync(monitorScript, `#!/bin/bash
set -u
DOC="${stoppageDocPath}"
STAMP="${stampFile}"
RESUME="${resumeFile}"
[ -f "$DOC" ] || exit 0
[ -f "$STAMP" ] || echo "0" > "$STAMP"
CUR=$(stat -f %m "$DOC" 2>/dev/null || echo 0)
OLD=$(cat "$STAMP")
if [ "$CUR" -gt "$OLD" ]; then
  awk '/^RESUME:/{f=1;next} f' "$DOC" > "$RESUME"
  echo "$CUR" > "$STAMP"
fi
`);
  import("node:fs").then(({ chmodSync }) => chmodSync(monitorScript, 0o755)).catch(() => {});

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_AGENT_LABEL}-${Buffer.from(parkDir).toString("hex").slice(0, 8)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${monitorScript}</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${join(parkDir, "monitor.log")}</string>
  <key>StandardErrorPath</key><string>${join(parkDir, "monitor.err")}</string>
</dict>
</plist>
`;
  const home = process.env.HOME ?? "/Users/douglastalley";
  const plistDir = join(home, "Library/LaunchAgents");
  try { mkdirSync(plistDir, { recursive: true }); } catch { /* may already exist */ }
  const plistPath = join(plistDir, `${LAUNCH_AGENT_LABEL}.plist`);
  writeFileSync(plistPath, plist);
  return plistPath;
}

/** Load the monitor (idempotent — load only if not already loaded). */
export async function loadMonitor(plistPath: string): Promise<boolean> {
  const { executeCommand } = await import("../tools/shell.js");
  const label = LAUNCH_AGENT_LABEL;
  // unload first (ignore errors), then load.
  await executeCommand("launchctl", ["unload", plistPath], process.cwd(), 5000).catch(() => null);
  const r = await executeCommand("launchctl", ["load", plistPath], process.cwd(), 5000).catch(() => null);
  void label;
  return r?.exitCode === 0;
}

/** Read the user's resume response if they've edited the doc. Returns null if not yet. */
export function readResumeResponse(parkDir: string): string | null {
  const resumeFile = join(parkDir, "RESUME.txt");
  if (!existsSync(resumeFile)) return null;
  try {
    const content = readFileSync(resumeFile, "utf8").trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}
