# Architecture

## Decisions

- **One main window** contains the Sigma UI and audio playback. The optional
  desktop-lyrics window is a second, transparent click-through window with a
  dedicated narrow preload; it only receives sanitized lyric text.
- **The main process owns settings, auth state, and API access.** The renderer
  never receives tokens, cookies, or the sidecar port.
- **Renderer is sandboxed:** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `webSecurity: true`, strict CSP.
- **Settings have one source of truth:** `electron-store` in the main process,
  mirrored read-only into a Pinia store through narrow IPC. No `localStorage`
  settings copy.
- **API access goes through a main-process proxy.** `api:request` is the only
  renderer-facing entry; it forwards allowlisted calls to the MIT KuGouMusicApi
  sidecar and keeps cookies/tokens in the main process.
- **JavaScript + JSDoc** rather than TypeScript for now, so the owner-authored
  Sigma UI can be ported without a mechanical rewrite. Type checking can be
  added incrementally.

## Layout

```
shared/
  ipc.js             IPC channel names (main + renderer)
  settings.js        setting defaults and sanitization (tested)
  apiPolicy.js       API allowlist, request/response sanitization (tested)
electron/
  main.js            app/window lifecycle, sidecar lifecycle, secure webPreferences
  tray.js            tray icon/menu and minimize-to-tray controller
  windows/           desktop-lyrics window controller
  preload.cjs        minimal contextBridge API
  preloadLyrics.cjs  desktop-lyrics-only bridge (state push)
  security/          trusted-sender validation (main + lyrics windows)
  services/          settings store, sidecar manager, API proxy, auth session
  ipc/               IPC handlers
src/
  main.js            Vue + Pinia + Router bootstrap
  App.vue            router view + settings subscription
  router/            hash-history routes (/, /login, /settings, /dev)
  views/             SigmaView, LoginView, SettingsView, HomeView (dev smoke test)
  stores/            settings, player, auth
  services/api/      renderer-side API client (calls the main proxy)
  services/lyrics/   LRC parser
  components/        Sigma UI
test/                node:test unit tests
docs/                architecture and clean-room provenance
api/                 KuGouMusicApi git submodule (MIT)
```

## Settings flow

1. Main initializes `electron-store` with defaults.
2. Renderer calls `settings:get` through preload and patches its Pinia store.
3. Renderer calls `settings:set`; main sanitizes the patch against the accepted
   quality/data-source values, persists it, and broadcasts `settings:changed`.
4. All windows mirror the same broadcast; no direct `localStorage` writes.
5. A data-source change restarts the sidecar with the matching platform and
   resets device cookies. A quality change reloads the current track at the new
   quality while preserving playback position. `/settings` exposes both, plus
   the account/login entry, minimize-to-tray, desktop lyrics, and update status.
6. With minimize-to-tray enabled, close/minimize hides the window and the tray
   menu restores it or quits; audio keeps playing because the renderer stays alive.
7. With desktop lyrics enabled, the main renderer loads and parses the current
   song's LRC, then pushes a change-only `{title, artist, current, next, playing}`
   state to main. Main sanitizes it and forwards it to a transparent, always-on-top,
   click-through window whose preload exposes only the state subscription.

## API flow

1. Main spawns the MIT KuGouMusicApi submodule as a child process on a random
   loopback-only port; the process is stopped on app quit.
2. Before the first forwarded request, main calls the sidecar's `/register/dev`
   once and keeps the returned device cookies (`dfid`, `KUGOU_API_*`) in memory.
3. Renderer calls `api:request` with path/method/params/body.
4. Main validates the sender, method, and allowlisted path prefix, attaches
   cookies/token held in main memory, and forwards to the sidecar.
5. Login and user responses have token fields stripped before returning to the
   renderer; cookies and the fallback auth header stay in main.
6. The login session (cookies, auth header, non-sensitive profile fields) is
   persisted encrypted with Electron `safeStorage`. If OS encryption is not
   available, it stays memory-only rather than being written in plaintext.
7. Search, public/user playlists, daily recommendations, and song URLs go through
   this proxy; audio and cover URLs are upgraded to HTTPS before the renderer
   sees them. QR login is available at `/login`.

## Playback

The renderer owns an `HTMLAudioElement` only; the song URL is requested from the
main proxy with the user's quality setting and falls back to lower quality when
the requested one is unavailable (for example 320 kbps → 128 kbps for guest
accounts). The queue, repeat/shuffle modes, and volume live in the Pinia player
store. The in-app lyrics view (`/lyrics`) searches Kugou lyrics by hash, asks the
sidecar to decode the LRC, highlights the current line from the audio clock, and
seeks on line click. Desktop lyrics are a follow-up. Remote media proxying is a
follow-up.

## Packaging

`npm run dist` builds the renderer and an NSIS installer. The KuGouMusicApi
sidecar is copied to `resources/api` (outside `app.asar`) together with its
production `node_modules`; main resolves that path through `process.resourcesPath`
when packaged. `tools/verify-pack.cjs` fails the build if the sidecar entry or its
runtime dependencies are missing. Release builds should run
`npm --prefix api prune --omit=dev` first so dev tooling is not shipped. Pushing a
`v*` tag runs `.github/workflows/release.yml`, which builds on Windows and uploads
the installer, `latest.yml`, and the blockmap through electron-builder; publish the
draft release before clients can see it. Code signing and installer identity are
not configured yet.

## Updates

`electron-updater` is wired to the repository's GitHub Releases. In a packaged
build it checks quietly 15 seconds after launch and on demand from `/settings`.
Downloads are opt-in (`autoDownload: false`); once downloaded, the update installs
on quit and the settings page offers an immediate restart. Development builds
report "dev" and never contact the update server. `Jello-Music-Setup-x.y.z.exe`,
`latest.yml`, and the `.blockmap` must be uploaded together to the GitHub release.
Builds are unsigned, so SmartScreen warnings and update signature hardening are
still open.

## Security baseline

- Every IPC handler validates `event.sender` and `event.senderFrame` against the
  registered main window; subframes are rejected.
- No `webSecurity: false`, no `allowRunningInsecureContent`, no webviews.
- CSP lives in `index.html`; new origins require review.
- No generic "fetch arbitrary URL" IPC; the API proxy has an allowlist.

## Roadmap

1. Sigma UI port (owner-authored components/assets, Roboto atlas font) — done.
2. KuGouMusicApi sidecar + main API proxy + QR login — done.
3. Search/playlists/daily recommendations against the real API — done.
4. Playback/queue engine — done; persistent login session — done.
5. Settings UI (quality, data source, account) — done.
6. In-app lyrics — done.
7. Windows packaging with sidecar — done (unpacked build verified).
8. Tray and minimize-to-tray — done; desktop lyrics — done.
9. Auto-update plumbing — done (release upload/signing still open).
10. Code signing, release workflow, sidecar token, broader tests.
