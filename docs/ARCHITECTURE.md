# Architecture

## Decisions

- **Single main window** contains the Sigma UI and audio playback. Auxiliary
  lyrics/spectrum windows can be added later over explicit IPC channels.
- **The main process owns settings, auth state, and API access.** The renderer
  never receives tokens, cookies, or the sidecar port.
- **Renderer is sandboxed:** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `webSecurity: true`, strict CSP.
- **Settings have one source of truth:** `electron-store` in the main process,
  mirrored read-only into a Pinia store through narrow IPC. No `localStorage`
  settings copy.
- **API access goes through a main-process proxy.** `api:request` is the only
  renderer-facing entry; it is currently a stub until the MIT KuGouMusicApi
  sidecar is connected.
- **JavaScript + JSDoc** rather than TypeScript for now, so the owner-authored
  Sigma UI can be ported without a mechanical rewrite. Type checking can be
  added incrementally.

## Layout

```
shared/
  ipc.js             IPC channel names (main + renderer)
  settings.js        setting defaults and sanitization (tested)
electron/
  main.js            app/window lifecycle, secure webPreferences
  preload.cjs        minimal contextBridge API
  security/          trusted-sender validation
  services/          settings store, future sidecar/API proxy/updater
  ipc/               IPC handlers
src/
  main.js            Vue + Pinia + Router bootstrap
  App.vue            router view + settings subscription
  router/            hash-history routes
  views/             pages (HomeView is the architecture smoke test)
  stores/            settings, player
  services/api/      renderer-side API client (calls the main proxy)
  components/        Sigma UI will live here
test/                node:test unit tests
docs/                architecture and clean-room provenance
```

## Settings flow

1. Main initializes `electron-store` with defaults.
2. Renderer calls `settings:get` through preload and patches its Pinia store.
3. Renderer calls `settings:set`; main sanitizes the patch, persists it, and
   broadcasts `settings:changed`.
4. All windows mirror the same broadcast; no direct `localStorage` writes.

## API flow (planned)

1. Main spawns KuGouMusicApi (MIT) on a loopback-only random port with a
   per-launch token.
2. Renderer calls `api:request` with path/method/params/body.
3. Main validates the sender and request shape, attaches auth cookies held in
   main, forwards to the sidecar, and returns only the needed JSON.
4. Remote media URLs are proxied separately; the renderer never gets auth
   cookies.

## Security baseline

- Every IPC handler validates `event.sender` and `event.senderFrame` against the
  registered main window; subframes are rejected.
- No `webSecurity: false`, no `allowRunningInsecureContent`, no webviews.
- CSP lives in `index.html`; new origins require review.
- No generic "fetch arbitrary URL" IPC; the API proxy has an allowlist.

## Roadmap

1. Sigma UI port (owner-authored components/assets, open font atlas).
2. KuGouMusicApi sidecar + main API proxy + login.
3. Search/playlists/daily recommendations.
4. Playback/queue engine, lyrics, settings UI.
5. Updater, tray, packaging, tests/CI.
