import { createInterface } from "node:readline";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import type { OpenMythosConfig } from "../config/schema.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { AdapterMessage } from "../core/types.js";

export interface ChatSession {
  workdir: string;
  config: OpenMythosConfig;
  adapters: AdapterRegistry;
  messages: AdapterMessage[];
  maxContextTurns: number;
}

export function createChatSession(
  workdir: string,
  config: OpenMythosConfig,
  adapters: AdapterRegistry
): ChatSession {
  return {
    workdir,
    config,
    adapters,
    messages: [],
    maxContextTurns: 20,
  };
}

export async function sendChatMessage(
  session: ChatSession,
  userText: string,
  onToken?: (token: string) => void
): Promise<string> {
  const trimmedMessages = session.messages.slice(-session.maxContextTurns);

  if (isFileReadRequest(userText)) {
    const result = await handleFileRead(session, userText);
    if (result !== null) return result;
  }

  if (isListRequest(userText)) {
    const result = await handleListFiles(session, userText);
    if (result !== null) return result;
  }

  const contextSummary = await buildProjectContext(session);
  const systemPrompt = buildSystemPrompt(session.workdir, contextSummary);

  trimmedMessages.push({ role: "user", content: userText });

  const model = session.config.models.coder;
  const request = {
    system: systemPrompt,
    maxTokens: model.maxTokens,
    temperature: model.temperature,
    json: false,
    messages: trimmedMessages,
  };

  const response = onToken
    ? await session.adapters.callStream("coder", request, onToken)
    : await session.adapters.call("coder", request);

  session.messages.push({ role: "user", content: userText });
  session.messages.push({ role: "assistant", content: response.content });

  return response.content;
}

export async function runChatRepl(session: ChatSession): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "openmythos> ",
  });

  console.log("OpenMythos Chat — interactive coding session");
  console.log(`Working directory: ${session.workdir}`);
  console.log("Type /help for commands, /quit to exit\n");

  const commands: Record<string, () => void> = {
    "/quit": () => { rl.close(); },
    "/exit": () => { rl.close(); },
    "/clear": () => {
      session.messages = [];
      console.log("Context cleared.\n");
      rl.prompt();
    },
    "/help": () => {
      console.log("Commands:");
      console.log("  /help     Show this help");
      console.log("  /clear    Clear conversation context");
      console.log("  /files    List files in working directory");
      console.log("  /quit     Exit chat");
      console.log("");
      rl.prompt();
    },
    "/files": async () => {
      await handleListFiles(session, "");
      rl.prompt();
    },
  };

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    const command = commands[input];
    if (command) { await command(); return; }
    if (input === "/quit" || input === "/exit") return;

    process.stdout.write("... thinking ...     \r");
    try {
      let firstToken = true;
      await sendChatMessage(session, input, (token) => {
        if (firstToken) {
          process.stdout.write("                     \r");
          firstToken = false;
        }
        process.stdout.write(token);
      });
      console.log("\n");
    } catch (error) {
      process.stdout.write("                     \r");
      console.error(`Error: ${(error as Error).message}`);
      console.log("");
    }
    rl.prompt();
  });

  return new Promise<void>((resolvePromise) => {
    rl.on("close", () => {
      console.log("\nGoodbye.");
      resolvePromise();
    });
  });
}

function isFileReadRequest(text: string): boolean {
  return /^(read|show|cat|open)\s+/i.test(text) && /\.\w/.test(text);
}

function isListRequest(text: string): boolean {
  return /^(list|ls|dir|files)\s*$/i.test(text) || text === "/files";
}

async function handleFileRead(session: ChatSession, text: string): Promise<string | null> {
  const match = text.match(/(?:read|show|cat|open)\s+(.+)/i);
  if (!match) return null;
  const filePath = match[1]!.trim().replace(/^["']|["']$/g, "");
  const absPath = resolve(session.workdir, filePath);
  if (!existsSync(absPath)) return null;
  try {
    const content = await readFile(absPath, "utf8");
    const rel = relative(session.workdir, absPath);
    const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n... (truncated)" : content;
    return `=== ${rel} ===\n${truncated}`;
  } catch {
    return null;
  }
}

async function handleListFiles(session: ChatSession, _text: string): Promise<string | null> {
  try {
    const entries = await readdir(session.workdir);
    const visible = entries.filter((e) => !e.startsWith(".") && !["node_modules", "dist", "build"].includes(e));
    const lines: string[] = [];
    for (const entry of visible.slice(0, 40)) {
      const entryPath = resolve(session.workdir, entry);
      const info = await stat(entryPath);
      lines.push(`${info.isDirectory() ? "[dir]" : "     "} ${entry}`);
    }
    console.log(lines.join("\n"));
    console.log("");
    return "";
  } catch {
    return null;
  }
}

async function buildProjectContext(session: ChatSession): Promise<string> {
  try {
    const entries = await readdir(session.workdir);
    const visible = entries.filter((e) => !e.startsWith(".") && !["node_modules", "dist", "build"].includes(e));
    const packageJsonPath = resolve(session.workdir, "package.json");
    let pkgInfo = "";
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
        pkgInfo = `Project: ${pkg.name || "unnamed"} ${pkg.version || ""}\n`;
        if (pkg.scripts) {
          pkgInfo += `Scripts: ${Object.keys(pkg.scripts).join(", ")}\n`;
        }
      } catch { /* ignore */ }
    }
    return `${pkgInfo}Files: ${visible.slice(0, 20).join(", ")}`;
  } catch {
    return "";
  }
}

function buildSystemPrompt(workdir: string, contextSummary: string): string {
  return `You are OpenMythos, the interactive coding assistant running inside the OpenMythos CLI.
You are powered by GLM-5.1 via the Z.AI coding endpoint.

## What OpenMythos Is

OpenMythos is a deterministic multi-model orchestration harness for agentic software work.
The core rule: code owns the loop. Models (including you) are bounded workers — they classify,
compress, plan, implement, critique, and verify — but the harness owns phase transitions,
state, validation, retries, local checks, and the audit trail.

## The VOID Terminal

The VOID terminal is the terminal interface you may be running in. It is a VOID-inspired
terminal surface built into OpenMythos with:
- An express + ws backend (port 4174) that streams shell sessions over WebSocket
- A React + Vite frontend (port 4175) with theme support
- The OMVOID splash banner — the ASCII art shown at boot

If the user is talking to you through the VOID terminal, they are in the browser-based
terminal UI connected to the OpenMythos backend. The terminal itself is just a shell —
you are the model that responds when they type \`openmythos chat\`.

You also have these OpenMythos surfaces available:
- \`openmythos loop\` — the code-driven worker/watcher/replace loop
- \`openmythos run\` — the deterministic phase-loop harness (intake → context → plan → execute → verify)
- \`openmythos sysmon\` — OMVOID banner + system monitor (btop)

## Your Role

You help developers understand, modify, and improve their code in the repository at ${workdir}.

${contextSummary}

When suggesting code changes:
- Be specific about file paths and line numbers
- Show the exact change needed
- Explain WHY the change is correct
- If you need to see a file, tell the user to type: read <filename>

Be concise. Prefer code over prose. If the task is complex, break it into steps.`;
}
