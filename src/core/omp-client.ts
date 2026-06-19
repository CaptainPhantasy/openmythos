// src/core/omp-client.ts
// OMP RPC client — spawns `omp --mode rpc`, sends a prompt, collects frames to agent_end.
// Port of the proven run_omp_turn() from evidence/eval/orchestrator.py. This is the
// single LLM execution primitive: one bounded worker turn = one process.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_OMP_BIN = "/Users/douglastalley/.local/bin/omp";
export const DEFAULT_MODEL_PROVIDER = "zhipu-coding-plan";
export const DEFAULT_MODEL_ID = "glm-5.1";

export interface OmpTurnOptions {
  prompt: string;
  workdir: string;
  /** Tag for metrics bookkeeping. */
  tag: string;
  /** Per-process temperature overlay (writes a temp YAML, passed via --config). */
  temperature?: number;
  /** Hard wall-clock deadline in seconds. */
  deadlineSec?: number;
  ompBin?: string;
  modelProvider?: string;
  modelId?: string;
  /** When set, injects OPENMYTHOS_EMPLOYEE_ROLE=<role> into the spawn env so the
   *  employee-discipline hook can constrain this hire. */
  employeeRole?: string;
}

export interface OmpTurnResult {
  tag: string;
  agentEnd: boolean;
  durationSec: number;
  frames: unknown[];
  tokensIn: number;
  tokensOut: number;
  text: string;
}

function writeTempOverlay(temperature: number): string {
  const dir = mkdtempSync(join(tmpdir(), "omp-overlay-"));
  const p = join(dir, "overlay.yml");
  writeFileSync(p, `temperature: ${temperature}\n`);
  return p;
}

function extractUsage(frame: unknown): Array<Record<string, number>> {
  const found: Array<Record<string, number>> = [];
  const walk = (o: unknown): void => {
    if (o && typeof o === "object") {
      const obj = o as Record<string, unknown>;
      if ("usage" in obj && obj.usage && typeof obj.usage === "object") {
        found.push(obj.usage as Record<string, number>);
      }
      for (const v of Object.values(obj)) walk(v);
    } else if (Array.isArray(o)) {
      for (const v of o) walk(v);
    }
  };
  walk(frame);
  return found;
}

export function runOmpTurn(opts: OmpTurnOptions): Promise<OmpTurnResult> {
  const {
    prompt, workdir, tag,
    temperature, deadlineSec = 600,
    ompBin = DEFAULT_OMP_BIN,
    modelProvider = DEFAULT_MODEL_PROVIDER,
    modelId = DEFAULT_MODEL_ID,
    employeeRole,
  } = opts;

  return new Promise((resolve) => {
    const start = Date.now();
    const cmd: string[] = [ompBin, "--mode", "rpc"];
    if (temperature !== undefined) {
      const overlay = writeTempOverlay(temperature);
      cmd.push("--config", overlay);
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (employeeRole) env.OPENMYTHOS_EMPLOYEE_ROLE = employeeRole;
    let proc: ChildProcess;
    try {
      proc = spawn(cmd[0]!, cmd.slice(1), {
        cwd: workdir,
        stdio: ["pipe", "pipe", "ignore"],
        env,
      });
    } catch (e) {
      resolve({ tag, agentEnd: false, durationSec: 0, frames: [], tokensIn: 0, tokensOut: 0, text: `[spawn failed: ${String(e)}]` });
      return;
    }
    process.stderr.write(`[omp:${tag}] spawned ${ompBin} --mode rpc (deadline ${deadlineSec}s, temp ${temperature ?? "default"})\n`);

    const frames: unknown[] = [];
    const textParts: string[] = [];
    let agentEnd = false;
    let tokIn = 0, tokOut = 0;
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      try { proc.stdin?.end(); } catch { /* ignore */ }
      try { proc.kill(); } catch { /* ignore */ }
      const dur = Math.round((Date.now() - start) / 100) / 10;
      process.stderr.write(`[omp:${tag}] done agentEnd=${agentEnd} ${dur}s tokIn=${tokIn} tokOut=${tokOut}\n`);
      resolve({
        tag, agentEnd,
        durationSec: dur,
        frames,
        tokensIn: tokIn,
        tokensOut: tokOut,
        text: textParts.join(""),
      });
    };

    const timer = setTimeout(() => done(), deadlineSec * 1000);

    const send = (obj: unknown) => {
      try { proc.stdin?.write(JSON.stringify(obj) + "\n"); } catch { /* pipe closed */ }
    };

    proc.on("error", () => { clearTimeout(timer); done(); });

    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let f: unknown;
        try { f = JSON.parse(trimmed); } catch { continue; }
        frames.push(f);
        const frame = f as Record<string, unknown>;
        for (const u of extractUsage(frame)) {
          tokIn += u.input ?? 0;
          tokOut += u.output ?? 0;
        }
        const type = frame.type;
        if (type === "message_update") {
          const ev = frame.assistantMessageEvent as Record<string, unknown> | undefined;
          if (ev && ev.type === "text_delta" && typeof ev.delta === "string") {
            textParts.push(ev.delta);
          }
        }
        if (type === "agent_end") {
          agentEnd = true;
          clearTimeout(timer);
          done();
        }
      }
    });

    proc.on("exit", () => { clearTimeout(timer); done(); });

    // Send model pin + prompt.
    send({ id: "m0", type: "set_model", provider: modelProvider, modelId });
    send({ id: "t1", type: "prompt", message: prompt });
  });
}

export function verifyOmpAvailable(ompBin = DEFAULT_OMP_BIN): boolean {
  return existsSync(ompBin);
}
