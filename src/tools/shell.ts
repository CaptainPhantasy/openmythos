import { execFile } from "node:child_process";

export interface ShellResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function executeShell(command: string, cwd: string, timeoutMs: number): Promise<ShellResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile("sh", ["-c", command], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }
    }, (error, stdout, stderr) => {
      resolve({
        command,
        exitCode: error ? Number((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        durationMs: Date.now() - started
      });
    });
  });
}
