export type DisplayThemeId =
  | "absolute-void"
  | "dracula"
  | "tokyo-night"
  | "gruvbox"
  | "nord"
  | "matrix"
  | "catppuccin";

export type DisplayFontId =
  | "phantasy-mono-pty"
  | "jetbrains-mono"
  | "fira-code"
  | "cascadia-code"
  | "sf-mono"
  | "inter"
  | "system";

export type DisplayDensity = "comfortable" | "compact" | "spacious";
export type DisplayMotion = "system" | "reduced" | "full";

export interface DisplaySettings {
  themeId: DisplayThemeId;
  fontId: DisplayFontId;
  fontSize: number;
  density: DisplayDensity;
  motion: DisplayMotion;
  showBackgroundEffects: boolean;
  highContrast: boolean;
}

export interface DisplayTheme {
  id: DisplayThemeId;
  name: string;
  description: string;
  source: string;
  tokens: Record<string, string>;
  terminal: Record<string, string>;
}

export interface DisplayFont {
  id: DisplayFontId;
  name: string;
  stack: string;
  description: string;
}

export const DISPLAY_SETTINGS_STORAGE_KEY = "void.display.settings.v1";

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  themeId: "absolute-void",
  fontId: "phantasy-mono-pty",
  fontSize: 13,
  density: "comfortable",
  motion: "system",
  showBackgroundEffects: true,
  highContrast: false,
};

export const DISPLAY_FONTS: DisplayFont[] = [
  {
    id: "phantasy-mono-pty",
    name: "Phantasy Mono PTY",
    stack: "'Phantasy Mono PTY', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    description: "Packaged VOID default: JetBrains Mono-derived with Floyd's Labs PTY glyph customizations.",
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    stack: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    description: "Default coding font with strong terminal readability.",
  },
  {
    id: "fira-code",
    name: "Fira Code",
    stack: "'Fira Code', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    description: "Popular programming font with graceful ligature fallback.",
  },
  {
    id: "cascadia-code",
    name: "Cascadia Code",
    stack: "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    description: "Microsoft terminal-oriented coding font.",
  },
  {
    id: "sf-mono",
    name: "SF Mono",
    stack: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    description: "Native platform monospace stack with zero web-font dependency.",
  },
  {
    id: "inter",
    name: "Inter",
    stack: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    description: "Clean UI font for prose-heavy workflows.",
  },
  {
    id: "system",
    name: "System UI",
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    description: "Fastest native UI stack with no external font lookup.",
  },
];

export const DISPLAY_THEMES: DisplayTheme[] = [
  {
    id: "absolute-void",
    name: "Void",
    description: "VOID native true-black glass theme.",
    source: "Local VOID design tokens",
    tokens: {
      black: "#000000",
      "void-1": "#010101",
      "void-2": "#020304",
      "void-3": "#04070a",
      panel: "rgba(0, 0, 0, 0.66)",
      "panel-strong": "rgba(0, 0, 0, 0.82)",
      glass: "rgba(4, 7, 10, 0.48)",
      "glass-soft": "rgba(6, 10, 14, 0.32)",
      line: "rgba(255, 255, 255, 0.055)",
      "line-soft": "rgba(255, 255, 255, 0.035)",
      "line-strong": "rgba(255, 255, 255, 0.08)",
      "line-cyan": "rgba(125, 220, 255, 0.28)",
      text: "rgba(245, 248, 252, 0.92)",
      "text-dim": "rgba(225, 232, 240, 0.7)",
      muted: "rgba(170, 180, 190, 0.58)",
      dim: "rgba(130, 142, 153, 0.42)",
      cyan: "#7ddcff",
      "cyan-soft": "rgba(125, 220, 255, 0.16)",
      "cyan-dim": "rgba(125, 220, 255, 0.08)",
      "cyan-rim": "rgba(125, 220, 255, 0.42)",
      blue: "#0a84ff",
      "blue-deep": "#005fd8",
      indigo: "#111846",
      green: "#5ee2a0",
      yellow: "#f5d76e",
      orange: "#ff9f4a",
      red: "#ff6961",
    },
    terminal: {
      background: "#000000",
      foreground: "#f5f8fc",
      cursor: "#7ddcff",
      cursorAccent: "#000000",
      selectionBackground: "#1f5366",
      black: "#0a0a0a",
      red: "#ff6961",
      green: "#5ee2a0",
      yellow: "#f5d76e",
      blue: "#7ddcff",
      magenta: "#c08bff",
      cyan: "#7ddcff",
      white: "#f5f8fc",
      brightBlack: "#6f7b85",
      brightRed: "#ff8a82",
      brightGreen: "#7df0b8",
      brightYellow: "#ffe390",
      brightBlue: "#a3e7ff",
      brightMagenta: "#dcb0ff",
      brightCyan: "#bff0ff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Purple-forward dark terminal classic.",
    source: "Dracula community terminal palette",
    tokens: {
      black: "#282a36",
      "void-1": "#1e1f29",
      "void-2": "#242631",
      "void-3": "#282a36",
      panel: "rgba(40, 42, 54, 0.76)",
      "panel-strong": "rgba(30, 31, 41, 0.9)",
      glass: "rgba(40, 42, 54, 0.52)",
      "glass-soft": "rgba(68, 71, 90, 0.28)",
      line: "rgba(248, 248, 242, 0.1)",
      "line-soft": "rgba(248, 248, 242, 0.06)",
      "line-strong": "rgba(248, 248, 242, 0.16)",
      "line-cyan": "rgba(139, 233, 253, 0.34)",
      text: "#f8f8f2",
      "text-dim": "rgba(248, 248, 242, 0.74)",
      muted: "#bd93f9",
      dim: "rgba(189, 147, 249, 0.48)",
      cyan: "#8be9fd",
      "cyan-soft": "rgba(139, 233, 253, 0.16)",
      "cyan-dim": "rgba(139, 233, 253, 0.08)",
      "cyan-rim": "rgba(139, 233, 253, 0.46)",
      blue: "#6272a4",
      "blue-deep": "#44475a",
      indigo: "#44475a",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      orange: "#ffb86c",
      red: "#ff5555",
    },
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Blue-black editor palette optimized for late sessions.",
    source: "Tokyo Night terminal/editor palette",
    tokens: {
      black: "#1a1b26",
      "void-1": "#16161e",
      "void-2": "#1a1b26",
      "void-3": "#24283b",
      panel: "rgba(26, 27, 38, 0.78)",
      "panel-strong": "rgba(22, 22, 30, 0.92)",
      glass: "rgba(36, 40, 59, 0.46)",
      "glass-soft": "rgba(41, 46, 66, 0.3)",
      line: "rgba(169, 177, 214, 0.1)",
      "line-soft": "rgba(169, 177, 214, 0.06)",
      "line-strong": "rgba(169, 177, 214, 0.16)",
      "line-cyan": "rgba(125, 207, 255, 0.34)",
      text: "#c0caf5",
      "text-dim": "rgba(192, 202, 245, 0.72)",
      muted: "#7aa2f7",
      dim: "rgba(122, 162, 247, 0.42)",
      cyan: "#7dcfff",
      "cyan-soft": "rgba(125, 207, 255, 0.16)",
      "cyan-dim": "rgba(125, 207, 255, 0.08)",
      "cyan-rim": "rgba(125, 207, 255, 0.42)",
      blue: "#7aa2f7",
      "blue-deep": "#3d59a1",
      indigo: "#414868",
      green: "#9ece6a",
      yellow: "#e0af68",
      orange: "#ff9e64",
      red: "#f7768e",
    },
    terminal: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#1a1b26",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox Dark",
    description: "Warm retro terminal contrast with earthy accents.",
    source: "Gruvbox dark hard palette",
    tokens: {
      black: "#1d2021",
      "void-1": "#1d2021",
      "void-2": "#282828",
      "void-3": "#32302f",
      panel: "rgba(40, 40, 40, 0.78)",
      "panel-strong": "rgba(29, 32, 33, 0.92)",
      glass: "rgba(50, 48, 47, 0.5)",
      "glass-soft": "rgba(60, 56, 54, 0.32)",
      line: "rgba(235, 219, 178, 0.1)",
      "line-soft": "rgba(235, 219, 178, 0.06)",
      "line-strong": "rgba(235, 219, 178, 0.16)",
      "line-cyan": "rgba(142, 192, 124, 0.34)",
      text: "#ebdbb2",
      "text-dim": "rgba(235, 219, 178, 0.72)",
      muted: "#a89984",
      dim: "rgba(168, 153, 132, 0.48)",
      cyan: "#8ec07c",
      "cyan-soft": "rgba(142, 192, 124, 0.16)",
      "cyan-dim": "rgba(142, 192, 124, 0.08)",
      "cyan-rim": "rgba(142, 192, 124, 0.46)",
      blue: "#83a598",
      "blue-deep": "#458588",
      indigo: "#665c54",
      green: "#b8bb26",
      yellow: "#fabd2f",
      orange: "#fe8019",
      red: "#fb4934",
    },
    terminal: {
      background: "#1d2021",
      foreground: "#ebdbb2",
      cursor: "#ebdbb2",
      cursorAccent: "#1d2021",
      selectionBackground: "#504945",
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic blue-gray palette with restrained contrast.",
    source: "Nord terminal palette",
    tokens: {
      black: "#2e3440",
      "void-1": "#242933",
      "void-2": "#2e3440",
      "void-3": "#3b4252",
      panel: "rgba(46, 52, 64, 0.78)",
      "panel-strong": "rgba(36, 41, 51, 0.92)",
      glass: "rgba(59, 66, 82, 0.48)",
      "glass-soft": "rgba(67, 76, 94, 0.3)",
      line: "rgba(216, 222, 233, 0.1)",
      "line-soft": "rgba(216, 222, 233, 0.06)",
      "line-strong": "rgba(216, 222, 233, 0.16)",
      "line-cyan": "rgba(136, 192, 208, 0.34)",
      text: "#eceff4",
      "text-dim": "rgba(229, 233, 240, 0.74)",
      muted: "#81a1c1",
      dim: "rgba(129, 161, 193, 0.46)",
      cyan: "#88c0d0",
      "cyan-soft": "rgba(136, 192, 208, 0.16)",
      "cyan-dim": "rgba(136, 192, 208, 0.08)",
      "cyan-rim": "rgba(136, 192, 208, 0.46)",
      blue: "#5e81ac",
      "blue-deep": "#4c566a",
      indigo: "#434c5e",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      orange: "#d08770",
      red: "#bf616a",
    },
    terminal: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      cursorAccent: "#2e3440",
      selectionBackground: "#4c566a",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "High-focus green-on-black terminal aesthetic.",
    source: "Common matrix terminal palette",
    tokens: {
      black: "#000000",
      "void-1": "#000800",
      "void-2": "#001100",
      "void-3": "#001a00",
      panel: "rgba(0, 8, 0, 0.8)",
      "panel-strong": "rgba(0, 0, 0, 0.92)",
      glass: "rgba(0, 24, 0, 0.44)",
      "glass-soft": "rgba(0, 40, 0, 0.24)",
      line: "rgba(0, 255, 65, 0.12)",
      "line-soft": "rgba(0, 255, 65, 0.06)",
      "line-strong": "rgba(0, 255, 65, 0.2)",
      "line-cyan": "rgba(0, 255, 65, 0.38)",
      text: "#d9ffe0",
      "text-dim": "rgba(217, 255, 224, 0.72)",
      muted: "#66ff88",
      dim: "rgba(102, 255, 136, 0.4)",
      cyan: "#00ff41",
      "cyan-soft": "rgba(0, 255, 65, 0.16)",
      "cyan-dim": "rgba(0, 255, 65, 0.08)",
      "cyan-rim": "rgba(0, 255, 65, 0.5)",
      blue: "#00cc33",
      "blue-deep": "#006b1a",
      indigo: "#003b0f",
      green: "#00ff41",
      yellow: "#ccff66",
      orange: "#99ff33",
      red: "#ff4d4d",
    },
    terminal: {
      background: "#000000",
      foreground: "#00ff41",
      cursor: "#00ff41",
      cursorAccent: "#000000",
      selectionBackground: "#064d16",
      black: "#001100",
      red: "#ff4d4d",
      green: "#00ff41",
      yellow: "#ccff66",
      blue: "#00cc33",
      magenta: "#66ff88",
      cyan: "#00ff99",
      white: "#d9ffe0",
      brightBlack: "#006b1a",
      brightRed: "#ff7777",
      brightGreen: "#5cff7d",
      brightYellow: "#ddff99",
      brightBlue: "#44ff66",
      brightMagenta: "#99ffbb",
      brightCyan: "#88ffcc",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    description: "Mocha palette adapted from the Oh My Posh Catppuccin theme family.",
    source: "https://github.com/JanDeDobbeleer/oh-my-posh/blob/main/themes/catppuccin.omp.json",
    tokens: {
      black: "#1e1e2e",
      "void-1": "#181825",
      "void-2": "#1e1e2e",
      "void-3": "#313244",
      panel: "rgba(30, 30, 46, 0.78)",
      "panel-strong": "rgba(24, 24, 37, 0.92)",
      glass: "rgba(49, 50, 68, 0.48)",
      "glass-soft": "rgba(69, 71, 90, 0.28)",
      line: "rgba(205, 214, 244, 0.1)",
      "line-soft": "rgba(205, 214, 244, 0.06)",
      "line-strong": "rgba(205, 214, 244, 0.16)",
      "line-cyan": "rgba(137, 220, 235, 0.34)",
      text: "#cdd6f4",
      "text-dim": "rgba(205, 214, 244, 0.74)",
      muted: "#bac2de",
      dim: "rgba(186, 194, 222, 0.46)",
      cyan: "#89dceb",
      "cyan-soft": "rgba(137, 220, 235, 0.16)",
      "cyan-dim": "rgba(137, 220, 235, 0.08)",
      "cyan-rim": "rgba(137, 220, 235, 0.46)",
      blue: "#89b4fa",
      "blue-deep": "#74c7ec",
      indigo: "#45475a",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      orange: "#fab387",
      red: "#f38ba8",
    },
    terminal: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      cursorAccent: "#1e1e2e",
      selectionBackground: "#45475a",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#89dceb",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#89dceb",
      brightWhite: "#a6adc8",
    },
  },
];

export function getDisplayTheme(themeId: DisplayThemeId): DisplayTheme {
  return DISPLAY_THEMES.find((theme) => theme.id === themeId) ?? DISPLAY_THEMES[0];
}

export function getDisplayFont(fontId: DisplayFontId): DisplayFont {
  return DISPLAY_FONTS.find((font) => font.id === fontId) ?? DISPLAY_FONTS[0];
}

export function sanitizeDisplaySettings(value: unknown): DisplaySettings {
  if (!value || typeof value !== "object") return DEFAULT_DISPLAY_SETTINGS;
  const candidate = value as Partial<DisplaySettings>;
  const themeIds = new Set(DISPLAY_THEMES.map((theme) => theme.id));
  const fontIds = new Set(DISPLAY_FONTS.map((font) => font.id));
  const densityIds = new Set<DisplayDensity>(["comfortable", "compact", "spacious"]);
  const motionIds = new Set<DisplayMotion>(["system", "reduced", "full"]);
  const fontSize = Number.isFinite(candidate.fontSize)
    ? Math.min(18, Math.max(11, Math.round(Number(candidate.fontSize))))
    : DEFAULT_DISPLAY_SETTINGS.fontSize;

  return {
    themeId: themeIds.has(candidate.themeId as DisplayThemeId)
      ? (candidate.themeId as DisplayThemeId)
      : DEFAULT_DISPLAY_SETTINGS.themeId,
    fontId: fontIds.has(candidate.fontId as DisplayFontId)
      ? (candidate.fontId as DisplayFontId)
      : DEFAULT_DISPLAY_SETTINGS.fontId,
    fontSize,
    density: densityIds.has(candidate.density as DisplayDensity)
      ? (candidate.density as DisplayDensity)
      : DEFAULT_DISPLAY_SETTINGS.density,
    motion: motionIds.has(candidate.motion as DisplayMotion)
      ? (candidate.motion as DisplayMotion)
      : DEFAULT_DISPLAY_SETTINGS.motion,
    showBackgroundEffects:
      typeof candidate.showBackgroundEffects === "boolean"
        ? candidate.showBackgroundEffects
        : DEFAULT_DISPLAY_SETTINGS.showBackgroundEffects,
    highContrast:
      typeof candidate.highContrast === "boolean"
        ? candidate.highContrast
        : DEFAULT_DISPLAY_SETTINGS.highContrast,
  };
}
