# Architecture

## Goals

- A maintainable, MIT-licensed desktop client for Windows.
- Security-first renderer: no Node.js in the UI, no `webSecurity: false`.
- Clean-room provenance: no copied code from MoeKoeMusic, MoeKoe-NextGen, or
  the legacy `jello-music-temp` GPL repository.
- Reuse only the author's own Sigma UI work, MIT/Apache third-party code, and
  the MIT `KuGouMusicApi` sidecar.

## Stack

- Electron 45 (main + sandboxed renderer)
- Vue 3 + Vite 8 for the renderer
- electron-builder 26 for Windows NSIS packaging
- Planned: KuGouMusicApi (MIT) as a local sidecar process

## Layout

```
electron/
  main.js        Electron main process and window lifecycle
  preload.cjs    Minimal contextBridge API
src/
  main.js        Vue bootstrap
  App.vue        Current skeleton screen
  styles.css     Global styles
docs/
  ARCHITECTURE.md
  CLEAN_ROOM.md
```

## Process boundaries

### Renderer

- Runs with `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `webSecurity: true`.
- Talks to the main process only through the preload API.
- Never receives API tokens, cookies, or the sidecar port directly.

### Main process

- Owns window lifecycle, the sidecar process, the API proxy, updates, tray,
  global shortcuts, and protocol handling.
- Validates every IPC sender (`webContents` and `senderFrame`).
- Will expose a narrow, typed IPC surface; no generic "invoke arbitrary URL".

### API sidecar (planned)

- `KuGouMusicApi` (MIT) runs on a loopback-only random port.
- Launched by the main process with a per-launch random token.
- Requests from the main proxy include that token; direct local access is
  rejected.
- The main process proxies renderer API calls and audio/image URLs; the
  renderer does not talk to the sidecar directly.

## Security baseline

- Keep `webSecurity: true`; never add `allowRunningInsecureContent`.
- Strict CSP in `index.html`; add origins only with a review.
- No remote code, no `eval`, no `nodeIntegration`.
- Preload exposes only explicit, minimal methods.
- Updater artifacts must be signed before public release; unsigned builds are
  development-only.

## Planned modules

1. Authentication (QR, phone, account) through the main-process API proxy.
2. Search, playlists, daily recommendations.
3. Playback/queue engine with explicit quality fallback.
4. Lyrics (desktop and in-app) with deterministic cleanup.
5. Settings with a single source of truth.
6. Sigma UI, reused from the author's own sigmarebase work after a provenance
   and asset/font license review.
7. Updater, tray, global shortcuts, Windows packaging.

## Testing and CI

- Add unit tests for pure logic (URL building, parsing, settings migrations).
- Add smoke tests for login, playback, queue, lyrics, and settings.
- CI must run build, tests, dependency audit, and packaging checks.
