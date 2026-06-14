import http from "node:http";
import { constants, readFileSync, accessSync } from "node:fs";
import { access } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(serverRoot, "..");
const frontendDist = resolve(projectRoot, "frontend/dist");
const cliPath = process.env.OPENMYTHOS_CLI_PATH || resolve(projectRoot, "dist/index.js");
const cliWorkdir = resolve(process.env.OPENMYTHOS_UI_WORKDIR || projectRoot);
const shellPath = process.env.OPENMYTHOS_SHELL || process.env.SHELL || "/bin/bash";
const controlToken = z.string().trim().min(1).optional().parse(process.env.OPENMYTHOS_CONTROL_TOKEN || process.env.VOID_CONTROL_TOKEN);
const ttyColsDefault = Number.parseInt(process.env.OPENMYTHOS_TTY_COLS ?? "120", 10);
const ttyRowsDefault = Number.parseInt(process.env.OPENMYTHOS_TTY_ROWS ?? "40", 10);
const port = Number.parseInt(process.env.PORT || "4174", 10);

const querySchema = z.object({
  workspace: z.string().trim().optional(),
  session: z.string().trim().max(120).optional(),
}).passthrough();

const health = {
  name: "openmythos-void-terminal",
  version: "0.15.0",
  websocket: "/ws/terminal",
  ui: "/",
};

const terminalSessions = new Map<string, ReturnType<typeof spawn>>();

app.get("/health", (_req, res) => {
  res.json({ ...health, status: "ok" });
});

app.get("/api/info", (_req, res) => {
  res.json({
    cli: "node dist/index.js run \"<goal>\"",
    runner: "openmythos",
    workspace: cliWorkdir,
    projectRoot,
  });
});

function frontendIndexPath(): string {
  return resolve(frontendDist, "index.html");
}

function serveFrontendFallback(): string {
  return `<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>OpenMythos Terminal</title></head><body><h1>OpenMythos Terminal</h1><p>Build missing. Set up the frontend with <code>npm run build --prefix void-terminal/frontend</code>.</p><p>Health: <a href=\"/health\">/health</a></p></body></html>`;
}

try {
  accessSync(frontendDist, constants.F_OK);
  app.use(express.static(frontendDist));
} catch {
  // Frontend not built yet.
}

app.get("*", (_req, res) => {
  try {
    const index = readFileSync(frontendIndexPath());
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(index);
    return;
  } catch {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(serveFrontendFallback());
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function resolveWorkspace(rawWorkspace: string | undefined): string {
  if (!rawWorkspace) {
    return cliWorkdir;
  }
  if (isAbsolute(rawWorkspace)) {
    return rawWorkspace;
  }
  return resolve(cliWorkdir, rawWorkspace);
}

function isAuthorized(url: URL): boolean {
  if (!controlToken) return true;
  const candidate = url.searchParams.get("control_token");
  if (!candidate) return false;

  const expected = createHash("sha256").update(controlToken).digest("hex");
  const actual = createHash("sha256").update(candidate).digest("hex");
  return expected === actual;
}

function safeClose(ws: WebSocket, code = 4401, reason = "unauthorized") {
  if (ws.readyState === ws.OPEN) {
    ws.close(code, reason);
    return;
  }
  ws.terminate();
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function wireTerminalSocket(
  ws: WebSocket,
  sessionId: string,
  workspace: string,
) {
  const shellArgs = ["-i"];

  const proc = spawn(shellPath, shellArgs, {
    cwd: workspace,
    env: {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
      COLUMNS: String(ttyColsDefault || 120),
      LINES: String(ttyRowsDefault || 40),
      OPENMYTHOS_WORKDIR: workspace,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  terminalSessions.set(sessionId, proc);

  const sendString = (value: string) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(value);
    }
  };

  const onSpawn = () => {
    sendString(`\r\n\x1b[38;5;39mopenmythos terminal\x1b[0m`);
    sendString(` session=${sessionId}`);
    sendString(` workspace=${workspace}\r\n`);
    sendString(`$ `);
  };

  const onStdout = (chunk: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(chunk);
    }
  };

  const onStderr = (chunk: Buffer) => {
    const colored = `\x1b[38;5;203m${chunk.toString()}\x1b[0m`;
    if (ws.readyState === ws.OPEN) {
      ws.send(colored);
    }
  };

  proc.stdout.on("data", onStdout);
  proc.stderr.on("data", onStderr);

  proc.once("spawn", onSpawn);

  proc.once("exit", (code) => {
    sendJson(ws, {
      type: "exit",
      code,
    });
    terminalSessions.delete(sessionId);
  });

  proc.once("error", (error) => {
    sendJson(ws, { type: "error", message: error.message });
    safeClose(ws, 1011, "shell spawn failed");
    terminalSessions.delete(sessionId);
  });

  ws.on("message", (raw) => {
    const processRef = terminalSessions.get(sessionId);
    if (!processRef?.stdin) {
      return;
    }

    if (typeof raw === "string") {
      let parsed: { op?: string; cols?: number; rows?: number } | null = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Intentionally fall through: treat as input.
      }

      if (parsed?.op === "resize") {
        if (typeof parsed.cols === "number" && typeof parsed.rows === "number") {
          const cols = Math.max(20, Math.floor(parsed.cols));
          const rows = Math.max(5, Math.floor(parsed.rows));
          processRef.stdin.write(`\u001b[8;${rows};${cols}t`);
        }
        return;
      }

      if (parsed?.op === "kill") {
        try {
          processRef.kill("SIGINT");
        } catch {
          // ignore
        }
        return;
      }

      processRef.stdin.write(raw);
      return;
    }

    if (raw instanceof ArrayBuffer) {
      const input = Buffer.from(raw);
      if (input.length > 256 * 1024) {
        sendJson(ws, { type: "error", message: "input frame rejected: too large" });
        return;
      }
      processRef.stdin.write(input);
      return;
    }

    if (raw instanceof Buffer) {
      if (raw.length > 256 * 1024) {
        sendJson(ws, { type: "error", message: "input frame rejected: too large" });
        return;
      }
      processRef.stdin.write(raw);
    }
  });

  const shutdown = () => {
    if (terminalSessions.has(sessionId)) {
      terminalSessions.delete(sessionId);
    }
    try {
      proc.kill("SIGHUP");
    } catch {
      // ignore
    }
  };

  ws.on("close", shutdown);
  ws.on("error", shutdown);
}

server.on("upgrade", (request, socket, head) => {
  if (!request.url) {
    socket.destroy();
    return;
  }

  const parsed = new URL(request.url, "http://localhost");
  if (parsed.pathname !== "/ws/terminal") {
    socket.destroy();
    return;
  }

  if (!isAuthorized(parsed)) {
    socket.destroy();
    return;
  }

  const parsedQuery = querySchema.parse(Object.fromEntries(parsed.searchParams.entries()));
  const workspace = resolveWorkspace(parsedQuery.workspace);

  const check = access(workspace)
    .then(() => true)
    .catch(() => false);

  void check.then((ok) => {
    if (!ok) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const sessionId = parsedQuery.session || randomUUID();
      wireTerminalSocket(ws, sessionId, workspace);
    });
  });
});

server.listen(port, () => {
  console.log(`OpenMythos Void-style terminal server on http://localhost:${port}`);
  console.log(`WebSocket terminal endpoint: ws://localhost:${port}/ws/terminal`);
  console.log(`Runner CLI: node ${cliPath} run <goal>`);
});
