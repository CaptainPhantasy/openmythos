# OpenMythos VOID-Style Terminal UI

This is an isolated VOID-inspired terminal surface for OpenMythos.
It is intentionally separate from the core harness engine so the harness remains the
single orchestrator for model calls and phase transitions.

## Design intent

- The UI is terminal-first and keeps local context in one place.
- The model is never called from UI controls directly.
- Commands run through the integrated shell, and the CLI run loop (`node dist/index.js run`)
  owns orchestration.

## Layout

- `void-terminal/server` — lightweight `express + ws` backend that exposes:
  - `/ws/terminal` websocket for shell streaming
  - `/health`, `/api/info`
- `void-terminal/frontend` — React + Vite terminal frontend (copied from VOID terminal styling/patterns)
  - Includes theme system support for `absolute-void`, `dracula`, `tokyo-night`,
    `gruvbox`, `nord`, `matrix`, and `catppuccin` palettes.

## Run (from repo root)

```bash
# one-time setup
npm run void:setup

# build terminal client and backend
npm run void:build

# run backend API server
npm run void:server
```

In a second terminal, run:

```bash
npm run void:ui
```

The UI then points at the local server websocket for shell sessions.

You can switch themes, fonts, density, and terminal font size from the in-app
theme bar (Theme, Font, Density, Size, and rendering toggles).

### OpenMythos orchestration workflow

From the terminal, start harness runs as usual:

```bash
node dist/index.js run "your goal"
```

That keeps OpenMythos in control of execution phases and retries; the UI is only a UX surface.

## Notes

- Set `OPENMYTHOS_CONTROL_TOKEN` (optional) to secure websocket access.
- Set `OPENMYTHOS_UI_WORKDIR` if you want the terminal shell to default into a non-repo path.
- The backend can be started in any directory; it auto-detects the project root.
