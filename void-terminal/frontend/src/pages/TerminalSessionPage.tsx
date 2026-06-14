import { useMemo } from "react";
import Terminal from "../components/terminal/Terminal";
import {
  DISPLAY_FONTS,
  DISPLAY_THEMES,
  DisplayFont,
  DisplayTheme,
} from "../theme/displaySettings";
import { useDisplaySettings } from "../theme/DisplaySettingsProvider";

const TERMINAL_SESSION_STORAGE_KEY = "openmythos.terminal.session.v1";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function getPersistentSessionId(): string {
  if (typeof window === "undefined") {
    return crypto.randomUUID();
  }
  const existing = window.sessionStorage.getItem(TERMINAL_SESSION_STORAGE_KEY);
  if (existing && SESSION_ID_PATTERN.test(existing)) {
    return existing;
  }
  const next = crypto.randomUUID();
  window.sessionStorage.setItem(TERMINAL_SESSION_STORAGE_KEY, next);
  return next;
}

export default function TerminalSessionPage() {
  const { settings, updateSettings } = useDisplaySettings();
  const sessionId = useMemo(getPersistentSessionId, []);
  const terminalChromeId = `terminal-chrome-${sessionId}`;
  const terminalStatusId = `terminal-status-${sessionId}`;

  const handleThemeChange = (themeId: string) => {
    updateSettings({ themeId: themeId as DisplayTheme["id"] });
  };

  const handleFontChange = (fontId: string) => {
    updateSettings({ fontId: fontId as DisplayFont["id"] });
  };

  const handleDensityChange = (density: string) => {
    updateSettings({
      density: density as "comfortable" | "compact" | "spacious",
    });
  };

  const handleFontSizeChange = (fontSize: number) => {
    updateSettings({ fontSize: Math.min(18, Math.max(11, fontSize)) });
  };

  return (
    <section className="openmythos-shell">
      <div className="openmythos-shell__header">
        <div className="openmythos-shell__title">
          <span className="openmythos-shell__icon" aria-hidden="true">
            🛡
          </span>
          <div>
            <h1>OpenMythos Terminal</h1>
            <p>Harness-first execution interface — models stay behind the runner.</p>
          </div>
        </div>
        <div className="openmythos-shell__chrome" id={terminalChromeId}>
          <span>Harness Controls</span>
        </div>
      </div>
      <div className="openmythos-shell__theme-bar">
        <div className="openmythos-theme-control">
          <label htmlFor={`theme-${sessionId}`}>Theme</label>
          <select
            id={`theme-${sessionId}`}
            value={settings.themeId}
            onChange={(evt) => handleThemeChange(evt.target.value)}
          >
            {DISPLAY_THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </div>

        <div className="openmythos-theme-control">
          <label htmlFor={`font-${sessionId}`}>Font</label>
          <select
            id={`font-${sessionId}`}
            value={settings.fontId}
            onChange={(evt) => handleFontChange(evt.target.value)}
          >
            {DISPLAY_FONTS.map((font) => (
              <option key={font.id} value={font.id}>
                {font.name}
              </option>
            ))}
          </select>
        </div>

        <div className="openmythos-theme-control openmythos-theme-control--inline">
          <label htmlFor={`density-${sessionId}`}>Density</label>
          <select
            id={`density-${sessionId}`}
            value={settings.density}
            onChange={(evt) => handleDensityChange(evt.target.value)}
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>
        </div>

        <div className="openmythos-theme-control openmythos-theme-control--inline">
          <label htmlFor={`font-size-${sessionId}`}>Size</label>
          <input
            id={`font-size-${sessionId}`}
            type="range"
            min={11}
            max={18}
            value={settings.fontSize}
            onChange={(evt) =>
              handleFontSizeChange(Number.parseInt(evt.target.value, 10))
            }
            aria-label="Terminal font size"
          />
          <span>{settings.fontSize}px</span>
        </div>

        <div className="openmythos-theme-control openmythos-theme-control--inline">
          <label htmlFor={`effects-${sessionId}`}>Background FX</label>
          <input
            id={`effects-${sessionId}`}
            type="checkbox"
            checked={settings.showBackgroundEffects}
            onChange={(evt) =>
              updateSettings({ showBackgroundEffects: evt.currentTarget.checked })
            }
          />
        </div>

        <div className="openmythos-theme-control openmythos-theme-control--inline">
          <label htmlFor={`contrast-${sessionId}`}>High Contrast</label>
          <input
            id={`contrast-${sessionId}`}
            type="checkbox"
            checked={settings.highContrast}
            onChange={(evt) =>
              updateSettings({ highContrast: evt.currentTarget.checked })
            }
          />
        </div>
      </div>
      <p className="openmythos-shell__subtitle">Session {sessionId}</p>
      <div id={terminalStatusId} className="openmythos-shell__status" />
      <div className="openmythos-shell__terminal">
        <Terminal
          sessionId={sessionId}
          variant="immersive"
          className="openmythos-terminal-host"
          chromePortalId={terminalChromeId}
          statusPortalId={terminalStatusId}
        />
      </div>
      <p className="openmythos-shell__hint">
        Run OpenMythos through this shell directly (for example: <code>node dist/index.js run "your goal"</code>). The runner owns the orchestration loop, the terminal remains a UI surface.
      </p>
    </section>
  );
}
