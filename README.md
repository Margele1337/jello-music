# Jello Music

Clean-room, MIT-licensed desktop client for Kugou Music.

## Status

Sigma player backed by the real KuGou API:

- Electron 45 + Vue 3 + Vite 8; secure main window plus an optional transparent
  desktop-lyrics window with its own narrow preload
- QR, phone/SMS-code, and username/password login with encrypted session
  persistence (`safeStorage`); cookies/token never reach the renderer. Phone
  login that returns several accounts opens a selection step before the session
  is kept.
- Real search, public/user playlists, daily recommendations, queue playback,
  quality fallback (FLAC/320/128), in-app lyrics, desktop lyrics, tray mode,
  real-time spectrum HUD, right-Shift dock/collapse, and quality/data-source
  settings
- Manual one-click concept-VIP daily claim (concept data source + login required)
- KuGouMusicApi sidecar on a random loopback port; the renderer only uses the
  allowlisted `api:request` IPC proxy
- `electron-updater` wired to this repository's GitHub Releases; installer,
  sidecar, and update metadata are produced by `npm run dist`
- `node:test` coverage for settings, API policy, URL normalization, lyrics,
  desktop-lyric state, and trusted senders

Multi-account selection covers the phone/SMS flow returning several accounts
(pick one and resubmit with its `userid`); there is no separate switcher between
saved accounts. Not implemented yet: code signing is wired to optional
`CSC_LINK` / `CSC_KEY_PASSWORD` repository secrets;
without them builds are unsigned. Core runtime flows were verified in a real
Electron window; phone SMS delivery and packaged self-update still need a live
account/release to exercise end to end.

## Development

Requires Node.js >= 20.19 on Windows.

```sh
npm run install-all   # root + MIT API submodule dependencies
npm run dev           # Vite + Electron + sidecar
npm run build         # renderer production build
npm test              # unit tests
npm run dist          # Windows NSIS installer (electron-builder)
```

Before packaging locally, run `npm --prefix api prune --omit=dev` so the sidecar
ships without dev tooling (the release workflow does this automatically).

## Security baseline

- The renderer never gets Node.js access.
- `webSecurity` stays enabled; do not add `allowRunningInsecureContent`.
- API calls go through the main-process allowlist proxy; covers are upgraded to
  HTTPS, while audio keeps the CDN protocol because some concept hosts only
  serve valid HTTP. Media is loaded directly from Kugou CDNs.
- The sidecar is loopback-only on a random port and requires a fresh per-launch
  token; direct local requests without it receive 401.
- Keep a strict CSP and review it whenever a new origin is added.
- Release hardening: the release job runs in the `release` GitHub environment
  (approval required) with only `contents: write`; checkout does not persist
  credentials; `v*` tags are protected from deletion and force-push; release
  tags should be signed (`git tag -s`). Known accepted risk until code signing
  lands: updates are unsigned and install silently on quit; `latest.yml`'s
  sha512 proves download integrity only, so a GitHub account/repo compromise
  could ship a malicious update. Code signing is planned once the user base
  justifies it.

## Third-party and provenance

- API sidecar: [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi), MIT
  (git submodule `api/`, LICENSE retained).
- Sigma UI font: Roboto, SIL Open Font License 1.1 (see
  `src/assets/sigma/fonts/OFL.txt`).
- See [NOTICE](NOTICE), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
  [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).
