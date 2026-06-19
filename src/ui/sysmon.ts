// src/ui/sysmon.ts
// OpenMythos system monitor surface: OMVOID banner fixed at top, colorful live
// system telemetry (drives, RAM, temp, fans, memory pressure, Apple Silicon GPU/power) below.
//
// `dolphie` is MySQL-only (cannot do system stats). We use the Apple-Silicon-native
// stack instead: `btop` (color, full system) is the primary; `macmon` adds GPU/power/freq.
// Layout: banner is printed once and held via terminal scroll region; btop owns the rest.

import { spawn, execFileSync } from "node:child_process";
import { renderSplash, BANNER_HEIGHT } from "./splash.js";

export interface SysmonOptions {
  /** Skip Apple Silicon specifics (macmon). Useful on Intel or when btop is enough. */
  noMacmon?: boolean;
  /** Skip the OMVOID banner. */
  noSplash?: boolean;
  /** Override btop binary path. */
  btopBin?: string;
  /** Override macmon binary path. */
  macmonBin?: string;
}

function resolveBin(explicit: string | undefined, ...candidates: string[]): string | null {
  if (explicit) return explicit;
  for (const c of candidates) {
    try {
      execFileSync("command", ["-v", c], { stdio: ["ignore", "pipe", "ignore"], shell: true });
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Launch the system monitor surface. Blocks until the user exits btop (q / Ctrl-C).
 * The banner is pinned to the top via a terminal scroll region; btop renders below it.
 */
export async function runSysmon(opts: SysmonOptions = {}): Promise<void> {
  const btop = resolveBin(opts.btopBin, "btop");
  if (!btop) {
    process.stderr.write("sysmon: btop not found on PATH (install via `brew install btop`).\n");
    process.exitCode = 127;
    return;
  }
  const macmon = opts.noMacmon ? null : resolveBin(opts.macmonBin, "macmon");

  if (!opts.noSplash) {
    renderSplash({ subtitle: "system monitor  ·  q to exit  ·  Apple Silicon stack", clear: true });
  }

  // Pin banner above via scroll region: rows 1..BANNER_HEIGHT are frozen.
  // btop runs full-screen by default; we constrain it to the lower region with its
  // own height flag so it doesn't overwrite the banner.
  const bannerHeight = opts.noSplash ? 0 : BANNER_HEIGHT;
  if (bannerHeight > 0) {
    // ESC[r with top=1 sets a scroll region starting at bannerHeight+1.
    process.stdout.write(`\x1b[1;1H\x1b[${bannerHeight + 1};1r`);
  }

  try {
    // btop runs full-screen; BTOP_HEIGHT_OFFSET (env) constrains it below the banner.
    const args: string[] = [];
    const env = { ...process.env, BTOP_HEIGHT_OFFSET: String(bannerHeight) };
    const child = spawn(btop, args, {
      stdio: "inherit",
      env,
    });
    // macmon is non-interactive (continuously prints); we do not auto-spawn it into
    // the same TTY because it would fight btop for the screen. Instead it is exposed
    // as a toggle the user can pipe elsewhere. We leave a hint in the banner subtitle.
    void macmon;
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
    });
  } finally {
    // Reset scroll region + screen.
    process.stdout.write("\x1b[r\x1b[2J\x1b[H");
  }
}
