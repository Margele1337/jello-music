# Architecture

## Decisions

- **One main window** contains the Sigma UI and audio playback. It can be docked
  to the right edge (40 px visible) with a 260 ms slide animation; right Shift
  toggles it globally through a Windows `GetAsyncKeyState` poll (`koffi`), since
  Electron `globalShortcut` cannot distinguish left/right Shift. Optional
  desktop-lyrics and spectrum-HUD windows are transparent, always-on-top,
  click-through windows with dedicated narrow preloads; they only receive
  sanitized lyric text or spectrum levels.
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
  windows/           desktop-lyrics and spectrum-HUD window controllers
  preload.cjs        minimal contextBridge API
  preloadLyrics.cjs  desktop-lyrics-only bridge (state push)
  preloadSpectrum.cjs spectrum-HUD-only bridge (band stream)
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
   quality while preserving playback position. `/settings` is a chip-tab panel
   (界面/声音/歌词/频谱/系统/数据源/账号/更新) exposing playback quality, playback
   rate, loudness normalization, audio output device, desktop lyrics + font,
   spectrum controls, auto-start (login item), sleep blocker, tray behavior,
   log directory, account/VIP, and update status.
6. With minimize-to-tray enabled, close/minimize hides the window and the tray
   menu restores it or quits; audio keeps playing because the renderer stays alive.
6b. Loudness normalization runs in the shared Web Audio graph
   (source → volumeGain → loudnessGain → destination): the song-url response's
   `{volume, volume_gain, volume_peak}` metadata is converted to a gain targeting
   -14 LUFS with peak clipping protection (gain clamped to [0.1, 3]). The graph
   can be started independently of the spectrum via `ensureAudioGraph`, and the
   output device is switched with `setSinkId` on the AudioContext (element sink
   is bypassed once the graph owns the routing).
7. With desktop lyrics enabled, the main renderer fetches the current song's
   KRC karaoke lyrics (falling back to plain LRC), pushes the full per-character
   payload on song change, and streams `{time, playing}` progress ticks every
   250ms. Main sanitizes both payloads and forwards them to a transparent,
   always-on-top window whose preload exposes only the state/progress
   subscriptions plus drag/resize/pointer/allowlist actions. The lyrics window
   renders the karaoke highlight (5ms interpolation between ticks), supports
   lock/click-through, drag, 8-direction resize, color/font controls, and
   play controls that forward as player commands, and persists its bounds.
8. With the spectrum HUD enabled, the owner-authored spectrum pipeline taps the
   shared audio element with an `AudioWorklet` (CORS-enabled media), performs the
   sigmarebase-style 1024-point FFT on each MP3 frame, and sends 114 raw levels
   plus song metadata to main. Main clamps/pads the levels and forwards them to
   the click-through HUD, which renders the gray bars, blurred-cover overlay, and
   bottom-left song info.

## API flow

1. Main spawns the MIT KuGouMusicApi submodule as a child process on a random
   loopback-only port; the process is stopped on app quit. It is launched through
   `sidecar-entry.cjs`, which preloads `sidecar-guard.cjs` and enforces a fresh
   per-launch `x-jello-token` header on every inbound request (401 otherwise).
   Requests that arrive while it is starting (or restarting after a data-source
   switch) wait for it.
2. Before the first forwarded request, main calls the sidecar's `/register/dev`
   once and keeps the returned device cookies (`dfid`, `KUGOU_API_*`) in memory.
3. Renderer calls `api:request` with path/method/params/body.
4. Main validates the sender, method, and allowlisted path prefix, attaches
   cookies/token held in main memory, and forwards to the sidecar.
5. Login and user responses have token fields stripped before returning to the
   renderer; cookies and the fallback auth header stay in main.
6. The login session (cookies, auth header, non-sensitive profile fields) is
   persisted encrypted with Electron's async `safeStorage` APIs; quit waits
   briefly for the write to finish. If OS encryption is not available, it stays
   memory-only rather than being written in plaintext.
7. Search, public/user playlists, daily recommendations, and song URLs go through
   this proxy. Covers are upgraded to HTTPS; audio URLs keep the CDN's original
   protocol because some concept-edition CDN hosts (`youthandroid2`) have a
   mismatched HTTPS certificate. `media-src` therefore allows `http:`. `/login`
   offers QR, phone/SMS-code (`/captcha/sent` → `/login/cellphone`), and
   username/password (`POST /login`, exact path also stripped of token fields)
   login. When phone login returns several accounts (`info_list`), the renderer
   shows a selection step and resubmits with the chosen `userid`. Login
   responses also strip `secu_params` and other token-shaped fields before
   reaching the renderer. Guest mode is remembered and cleared on the next
   successful login.
8. The settings account card can manually claim the concept-edition daily VIP
   (`/youth/day/vip` → `/youth/day/vip/upgrade`). It is never automatic; it needs
   a logged-in session with the concept data source, and the same token-field
   stripping applies.

## Playback

The renderer owns an `HTMLAudioElement` only; the song URL is requested from the
main proxy with the user's quality setting and falls back to lower quality when
the requested one is unavailable (for example 320 kbps → 128 kbps for guest
accounts). Media URLs are loaded directly from the Kugou CDN, not proxied; some
concept CDN hosts only serve valid HTTP, so the CSP media policy allows both
protocols while scripts and API calls stay locked down. The queue, repeat/shuffle modes, and volume live in the Pinia player
store. The in-app lyrics view (`/lyrics`) searches Kugou lyrics by hash, asks the
sidecar to decode the LRC, highlights the current line from the audio clock, and
seeks on line click. Desktop lyrics are a follow-up. Remote media proxying is a
follow-up.

## Packaging

`npm run dist` builds the renderer and an NSIS installer. The release job runs
in the `release` GitHub environment with a required reviewer and only
`contents: write` (top-level workflow permissions stay `contents: read`), and
the checkout does not persist credentials. Repository settings to keep in place:
a ruleset protecting `v*` tags from deletion and force-push, and signed release
tags (`git tag -s`, verify with `git tag -v`). The KuGouMusicApi
sidecar is copied to `resources/api` (outside `app.asar`) together with its
production `node_modules`; main resolves that path through `process.resourcesPath`
when packaged. The wrapper and token guard are copied next to the sidecar.
`tools/verify-pack.cjs` fails the build if the sidecar entry, wrapper/guard, or
runtime dependencies are missing. Release builds should run
`npm --prefix api prune --omit=dev` first so dev tooling is not shipped. Pushing a
`v*` tag runs `.github/workflows/release.yml`, which builds on Windows and uploads
the installer, `latest.yml`, and the blockmap through electron-builder; publish the
draft release before clients can see it. The release workflow reads optional
`CSC_LINK` and `CSC_KEY_PASSWORD` repository secrets; without them the installer
is unsigned and SmartScreen warnings remain.

## Dock / right Shift

The main process owns the window dock state. `right Shift` (global, polled via
`GetAsyncKeyState`) or the visible 41 px strip toggles between the normal position
and a 40 px visible strip at the right edge of the current display. The slide
animation is renderer-rAF driven and replicates the original
`updatePanelDimensions`: each frame `x += (target - x) * 0.25 * (dt / 18.10361ms)`
and `y` with a 0.2 factor, so the motion is an exponential approach synced to
the display. If the renderer stops sending frames for 150 ms (window off-screen,
rAF throttled), the main process takes over with the same formula on a 4 ms tick.
Toggles are throttled to 120 ms; a running animation is cancelled and reversed
from the current position. Revealing the panel raises it above other windows for
600 ms (held while a fullscreen app is foreground, then dropped). The renderer
receives `window:dock-changed` and fades the Sigma UI to 50% while docked. The
strip click sends `window:restore`; tray "show" also restores a docked window.
The poll only reads the Shift virtual-key state and never installs a keyboard
hook.

## Updates

`electron-updater` is wired to the repository's GitHub Releases. In a packaged
build it checks quietly 15 seconds after launch and on demand from `/settings`.
Downloads are opt-in (`autoDownload: false`); once downloaded, the update installs
on quit and the settings page offers an immediate restart. Development builds
report "dev" and never contact the update server. `Jello-Music-Setup-x.y.z.exe`,
`latest.yml`, and the `.blockmap` must be uploaded together to the GitHub release.
Builds are unsigned, so SmartScreen warnings remain and the update channel
trusts GitHub Releases entirely — updates install silently on quit, and
`latest.yml`'s sha512 only proves download integrity, not publisher identity.
Authenticode signing plus `publisherName` (electron-updater then verifies update
signatures) is the planned fix once the user base justifies it.

## Security baseline

- Every IPC handler validates `event.sender` and `event.senderFrame` against the
  registered main window; subframes are rejected.
- CSP lives in `index.html` but is not static: `vite.config.js` rewrites the
  meta tag from `shared/csp.js` (`buildCsp({ dev })`) — dev gets the Vite HMR
  `ws://127.0.0.1:5173` origins, packaged builds never mention the dev port.
  Header-based injection was rejected on purpose: the packaged main window is a
  `file:` document, so a response header would either miss it entirely or
  intersect with the tray-menu page's own `file:`-based meta CSP and break it.
- `connect-src` allowlists KuGou CDN suffixes (`kugou.com`, `kgimg.com`) instead
  of a wide `https:`. The renderer calls `auditCspTarget` before the spectrum
  self-decode fetch and before handing a media URL to `<audio>`; hosts outside
  the list log a `[csp-audit]` line to main.log. A missing host degrades only
  the spectrum path (remote-URL playback continues) and shows up in the audit
  log — that is the procedure for extending the list. `media-src` remains broad
  until the collected host list justifies narrowing it.
- No `webSecurity: false`, no `allowRunningInsecureContent`, no webviews.
- No generic "fetch arbitrary URL" IPC; the API proxy has an allowlist.
- The sidecar requires a random per-launch token supplied by main; direct local
  requests without it are rejected before reaching Express.

## Roadmap

1. Sigma UI port (owner-authored components/assets, Roboto atlas font) — done.
2. KuGouMusicApi sidecar + main API proxy + QR login — done.
3. Search/playlists/daily recommendations against the real API — done.
4. Playback/queue engine — done; persistent login session — done.
5. Settings UI (quality, data source, account) — done.
6. In-app lyrics — done.
7. Windows packaging with sidecar — done (unpacked build verified).
8. Tray and minimize-to-tray — done; desktop lyrics — done.
9. Real-time spectrum HUD — done.
10. Auto-update plumbing — done (release upload/signing still open).
11. QR + phone/SMS + username/password login, phone multi-account selection
    (`info_list`), and guest memory — done.
12. Manual concept-VIP daily claim — done (never automatic).
13. Per-launch sidecar token — done.
14. Code signing and broader tests.
