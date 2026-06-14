import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useDisplaySettings } from "../../theme/DisplaySettingsProvider";

interface TerminalProps {
  sessionId?: string;
  workspace?: string;
  onReady?: (terminal: XTerm, ws: WebSocket) => void;
  className?: string;
  variant?: "framed" | "embedded" | "immersive";
  chromePortalId?: string;
  statusPortalId?: string;
}

const MAX_CLIENT_FRAME_BYTES = 256 * 1024;
const CONTROL_TOKEN = import.meta.env.VITE_VOID_CONTROL_TOKEN as string | undefined;

function socketIsClosable(socket: WebSocket | null): socket is WebSocket {
  return Boolean(socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING));
}

export default function Terminal({ sessionId, workspace, onReady, className = "", variant = "framed", chromePortalId, statusPortalId }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const resizeRetryTimersRef = useRef<number[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const inputEncoderRef = useRef(new TextEncoder());
  const outputDecoderRef = useRef(new TextDecoder());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chromePortalElement, setChromePortalElement] = useState<HTMLElement | null>(null);
  const [statusPortalElement, setStatusPortalElement] = useState<HTMLElement | null>(null);
  const { settings, activeTheme, activeFont } = useDisplaySettings();
  const displayOptionsRef = useRef({
    theme: activeTheme.terminal,
    fontFamily: activeFont.stack,
    fontSize: settings.fontSize,
    lineHeight: settings.density === "compact" ? 1.15 : settings.density === "spacious" ? 1.35 : 1.25,
  });

  useEffect(() => {
    displayOptionsRef.current = {
      theme: activeTheme.terminal,
      fontFamily: activeFont.stack,
      fontSize: settings.fontSize,
      lineHeight: settings.density === "compact" ? 1.15 : settings.density === "spacious" ? 1.35 : 1.25,
    };
  }, [activeFont.stack, activeTheme.terminal, settings.density, settings.fontSize]);

  useEffect(() => {
    if (!chromePortalId) {
      setChromePortalElement(null);
      return;
    }
    setChromePortalElement(document.getElementById(chromePortalId));
  }, [chromePortalId]);

  useEffect(() => {
    if (!statusPortalId) {
      setStatusPortalElement(null);
      return;
    }
    setStatusPortalElement(document.getElementById(statusPortalId));
  }, [statusPortalId]);

  const sendResize = useCallback(() => {
    const socket = wsRef.current;
    const terminal = xtermRef.current;
    if (!socket || !terminal || socket.readyState !== WebSocket.OPEN) return;
    if (terminal.cols < 1 || terminal.rows < 1) return;
    try {
      socket.send(JSON.stringify({ op: "resize", cols: terminal.cols, rows: terminal.rows }));
    } catch {
      setError("Terminal resize sync failed");
    }
  }, []);

  const fitTerminalToFrame = useCallback((generation = generationRef.current): boolean => {
    if (generation !== generationRef.current) return false;
    const host = terminalRef.current;
    const terminal = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    if (!host || !terminal || !fitAddon) return false;

    const rect = host.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16) return false;

    const proposed = fitAddon.proposeDimensions();
    if (!proposed || proposed.cols < 2 || proposed.rows < 1) return false;

    fitAddon.fit();
    sendResize();
    return true;
  }, [sendResize]);

  const scheduleFit = useCallback((generation = generationRef.current) => {
    if (generation !== generationRef.current || animationFrameRef.current != null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      try {
        fitTerminalToFrame(generation);
      } catch {
        // Fit can race DOM/font/layout settling; resize observers and settle timers retry.
      }
    });
  }, [fitTerminalToFrame]);

  const scheduleSettleFits = useCallback((generation = generationRef.current) => {
    for (const delay of [0, 50, 150, 300]) {
      const timer = window.setTimeout(() => {
        resizeRetryTimersRef.current = resizeRetryTimersRef.current.filter((item) => item !== timer);
        scheduleFit(generation);
      }, delay);
      resizeRetryTimersRef.current.push(timer);
    }
  }, [scheduleFit]);

  const cleanupTerminal = useCallback((closeCode = 1000, closeReason = "terminal cleanup") => {
    generationRef.current += 1;

    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    for (const timer of resizeRetryTimersRef.current) {
      window.clearTimeout(timer);
    }
    resizeRetryTimersRef.current = [];

    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;

    for (const disposable of disposablesRef.current) {
      try {
        disposable.dispose();
      } catch {
        // XTerm disposables are best-effort during teardown.
      }
    }
    disposablesRef.current = [];

    if (socketIsClosable(wsRef.current)) {
      wsRef.current.close(closeCode, closeReason);
    }
    wsRef.current = null;

    xtermRef.current?.dispose();
    xtermRef.current = null;
    fitAddonRef.current = null;
    outputDecoderRef.current = new TextDecoder();
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!terminalRef.current) return;

    cleanupTerminal();
    const generation = generationRef.current;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
    const baseWsUrl = `${protocol}//${host}${basePath}/ws/terminal`;
    const params = new URLSearchParams();
    if (CONTROL_TOKEN) params.set("control_token", CONTROL_TOKEN);
    if (workspace) params.set("workspace", workspace);
    if (sessionId) params.set("session", sessionId);
    const query = params.toString();
    const wsUrl = query ? `${baseWsUrl}?${query}` : baseWsUrl;

    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    wsRef.current = socket;
    const displayOptions = displayOptionsRef.current;

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: displayOptions.fontSize,
      lineHeight: displayOptions.lineHeight,
      letterSpacing: 0.2,
      fontFamily: displayOptions.fontFamily,
      fontWeight: "400",
      fontWeightBold: "600",
      theme: displayOptions.theme,
      allowProposedApi: true,
      scrollback: 10_000,
      drawBoldTextInBrightColors: true,
      smoothScrollDuration: 120,
      convertEol: true,
    });
    xtermRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(terminalRef.current);

    scheduleSettleFits(generation);

    disposablesRef.current = [
      terminal.onData((data) => {
        const activeSocket = wsRef.current;
        if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
        const bytes = inputEncoderRef.current.encode(data);
        if (bytes.byteLength > MAX_CLIENT_FRAME_BYTES) {
          terminal.write("\r\n\x1b[38;5;203minput frame rejected: too large\x1b[0m\r\n");
          return;
        }
        try {
          activeSocket.send(bytes);
        } catch {
          setError("Terminal input send failed");
        }
      }),
      terminal.onResize(({ cols, rows }) => {
        const activeSocket = wsRef.current;
        if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN || cols < 1 || rows < 1) return;
        try {
          activeSocket.send(JSON.stringify({ op: "resize", cols, rows }));
        } catch {
          setError("Terminal resize sync failed");
        }
      }),
    ];

    const observer = new ResizeObserver(() => {
      scheduleFit(generation);
    });
    observer.observe(terminalRef.current);
    if (terminalRef.current.parentElement) {
      observer.observe(terminalRef.current.parentElement);
    }
    resizeObserverRef.current = observer;

    const handleViewportResize = () => scheduleSettleFits(generation);
    const handleVisibilityChange = () => {
      if (!document.hidden) scheduleSettleFits(generation);
    };
    window.addEventListener("resize", handleViewportResize, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    disposablesRef.current.push(
      { dispose: () => window.removeEventListener("resize", handleViewportResize) },
      { dispose: () => document.removeEventListener("visibilitychange", handleVisibilityChange) },
    );

    document.fonts?.ready.then(() => {
      if (generation === generationRef.current) scheduleSettleFits(generation);
    }).catch(() => {
      // Font readiness is advisory; ResizeObserver remains the authority.
    });

    socket.onopen = () => {
      if (generation !== generationRef.current) return;
      setConnected(true);
      setError(null);
      scheduleSettleFits(generation);
      onReady?.(terminal, socket);
    };

    socket.onmessage = (event) => {
      if (generation !== generationRef.current) return;
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data) as { type?: string; message?: string; code?: number | null };
          if (message.type === "error") {
            const text = message.message || "Terminal control error";
            setError(text);
            terminal.write(`\r\n\x1b[38;5;203m● ${text}\x1b[0m\r\n`);
          } else if (message.type === "exit") {
            terminal.write(`\r\n\x1b[38;5;81m[process exited · code ${message.code ?? "unknown"}]\x1b[0m\r\n`);
          }
        } catch {
          terminal.write(event.data);
        }
        return;
      }

      const bytes = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : event.data instanceof Blob
          ? null
          : event.data;
      if (bytes instanceof Uint8Array) {
        terminal.write(outputDecoderRef.current.decode(bytes, { stream: true }));
      }
    };

    socket.onclose = () => {
      if (generation !== generationRef.current) return;
      setConnected(false);
      terminal.write("\r\n\x1b[38;5;215m●\x1b[0m \x1b[2mdisconnected\x1b[0m\r\n");
    };

    socket.onerror = () => {
      if (generation !== generationRef.current) return;
      setError("Connection failed");
      terminal.write("\r\n\x1b[38;5;203m●\x1b[0m \x1b[2mconnection error — is the backend running?\x1b[0m\r\n");
    };
  }, [cleanupTerminal, onReady, scheduleFit, scheduleSettleFits, sessionId, workspace]);

  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;
    terminal.options.theme = activeTheme.terminal;
    terminal.options.fontFamily = activeFont.stack;
    terminal.options.fontSize = settings.fontSize;
    terminal.options.lineHeight = settings.density === "compact" ? 1.15 : settings.density === "spacious" ? 1.35 : 1.25;
    scheduleSettleFits();
  }, [activeFont.stack, activeTheme.terminal, scheduleSettleFits, settings.density, settings.fontSize]);

  useEffect(() => {
    connect();
    return () => cleanupTerminal();
  }, [connect, cleanupTerminal]);

  const handleReconnect = useCallback(() => {
    cleanupTerminal(1000, "manual reconnect");
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, 0);
  }, [cleanupTerminal, connect]);

  const handleKill = useCallback(() => {
    const socket = wsRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ op: "kill" }));
      } catch {
        setError("Terminal kill signal failed");
      }
    }
  }, []);

  const isEmbedded = variant === "embedded";
  const frameClassName = isEmbedded
    ? `relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-transparent ${className}`
    : variant === "immersive"
      ? `relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border border-[color:var(--line)] bg-black shadow-2xl shadow-black/70 ${className}`
      : `relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[color:var(--line)] bg-black ${className}`;
  const chromeClassName = isEmbedded
    ? "hairline-b flex shrink-0 items-center justify-between bg-black/20 px-4 py-2"
    : "hairline-b flex shrink-0 items-center justify-between px-3 py-1.5";
  const actionButtonClassName = isEmbedded
    ? "btn-transition-token min-h-8 rounded-lg border border-border-subtle bg-white/[0.025] px-3 py-1 text-xs tracking-[0.06em] text-[color:var(--muted)] hover:bg-white/[0.045] hover:text-[color:var(--text)]"
    : "btn-transition-token rounded-md px-2 py-0.5 text-[10.5px] tracking-[0.06em] text-[color:var(--muted)] hover:bg-white/[0.04] hover:text-[color:var(--text)]";
  const killButtonClassName = isEmbedded
    ? "btn-transition-token min-h-8 rounded-lg border border-border-subtle bg-white/[0.025] px-3 py-1 text-xs tracking-[0.06em] text-[color:var(--muted)] hover:bg-white/[0.045] hover:text-[color:var(--red)]"
    : "btn-transition-token rounded-md px-2 py-0.5 text-[10.5px] tracking-[0.06em] text-[color:var(--muted)] hover:bg-white/[0.04] hover:text-[color:var(--red)]";
  const reconnectButtonClassName = isEmbedded
    ? "btn-transition-token min-h-8 rounded-lg border border-border-subtle bg-white/[0.025] px-3 py-1 text-xs tracking-[0.06em] text-[color:var(--muted)] hover:bg-white/[0.045] hover:text-[color:var(--cyan)]"
    : "btn-transition-token rounded-md px-2 py-0.5 text-[10.5px] tracking-[0.06em] text-[color:var(--muted)] hover:bg-white/[0.04] hover:text-[color:var(--cyan)]";
  const terminalViewportClassName = isEmbedded
    ? "min-h-0 min-w-0 flex-1 overflow-hidden bg-black p-4"
    : "min-h-0 min-w-0 flex-1 overflow-hidden bg-black p-2";
  const chromeContent = (
    <>
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            connected ? "terminal-status-online" : "terminal-status-offline"
          }`}
          aria-hidden="true"
        />
        <span className="text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--muted)]">
          {connected ? "terminal" : "disconnected"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => xtermRef.current?.clear()}
          className={actionButtonClassName}
          title="Clear terminal"
          type="button"
        >
          Clear
        </button>
        <button
          onClick={handleKill}
          className={killButtonClassName}
          title="Terminate shell process group"
          type="button"
        >
          Kill
        </button>
        <button
          onClick={handleReconnect}
          className={reconnectButtonClassName}
          title="Reconnect terminal"
          type="button"
        >
          Reconnect
        </button>
      </div>
    </>
  );
  const chrome = chromePortalElement
    ? createPortal(chromeContent, chromePortalElement)
    : chromePortalId
      ? null
      : <div className={chromeClassName}>{chromeContent}</div>;
  const statusContent = (
    <>
      <span className={connected ? "text-[color:var(--cyan)]" : "text-[color:var(--orange)]"} aria-hidden="true">
        ●
      </span>
      <span className="ml-2 text-[color:var(--muted)]">
        {connected ? "connected" : "disconnected"} · native binary PTY
      </span>
    </>
  );
  const status = statusPortalElement ? createPortal(statusContent, statusPortalElement) : null;


  return (
    <div className={frameClassName}>
      {chrome}
      {status}

      <div className={terminalViewportClassName}>
        <div
          ref={terminalRef}
          className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-black [&_.xterm]:h-full [&_.xterm]:w-full [&_.xterm-screen]:h-full [&_.xterm-viewport]:!h-full [&_.xterm-viewport]:!w-full"
        />
      </div>

      {error && (
        <div className="status-danger-surface absolute bottom-2 left-2 right-2 rounded-md px-3 py-2 text-[11px]">
          {error}
        </div>
      )}
    </div>
  );
}
