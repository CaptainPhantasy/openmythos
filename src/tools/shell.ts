import { execFile } from "node:child_process";

export interface ShellResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function executeShell(command: string, cwd: string, timeoutMs: number): Promise<ShellResult> {
  return executeProcess("sh", ["-c", command], cwd, timeoutMs, command);
}

export function executeCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ShellResult> {
  return executeProcess(command, args, cwd, timeoutMs, [command, ...args].join(" "));
}

function executeProcess(command: string, args: string[], cwd: string, timeoutMs: number, display: string): Promise<ShellResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }
    }, (error, stdout, stderr) => {
      resolve({
        command: display,
        exitCode: error ? Number((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        durationMs: Date.now() - started
      });
    });
  });
}
