// src/ui/splash.ts
// OpenMythos boot banner — the OMVOID splash. Banner art lives in splash.txt
// (ASCII box-drawing contains backticks that collide with TS template literals).
// Rendered at the top of the terminal before any other surface (dashboard, sysmon, harness loop).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BANNER_PATH = resolve(here, "splash.txt");

let cachedBanner: string | null = null;

export function getBanner(): string {
  if (cachedBanner === null) {
    cachedBanner = readFileSync(BANNER_PATH, "utf8");
  }
  return cachedBanner;
}

export interface SplashOptions {
  /** Subtitle line shown under the banner (e.g. version, current goal). */
  subtitle?: string;
  /** Flush a screen-clear before drawing. Default true. */
  clear?: boolean;
}

/** Render the OMVOID banner to stdout, optionally with a subtitle line. */
export function renderSplash(opts: SplashOptions = {}): void {
  const { subtitle, clear = true } = opts;
  if (clear) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
  process.stdout.write("\x1b[1;36m" + getBanner() + "\x1b[0m");
  if (subtitle) {
    process.stdout.write("\n" + "\x1b[2m" + subtitle + "\x1b[0m\n");
  }
  process.stdout.write("\n");
}

/** Banner height in terminal rows (for scroll-region math). */
export const BANNER_HEIGHT = 16;
