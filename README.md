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
  HTTPS. Audio is fetched by the main process through the `jello-media://`
  protocol with per-host HTTPS upgrade; only concept-CDN hosts with mismatched
  certificates stay on HTTP, and only on the main-process→CDN leg.
- The sidecar is loopback-only on a random port and requires a fresh per-launch
  token; direct local requests without it receive 401.
- Keep a strict CSP, reviewed per change: it is written into `index.html` by
  `vite.config.js` from `shared/csp.js` — dev builds carry the Vite HMR origins,
  packaged builds do not. All media and cross-origin traffic goes through the
  `jello-media://` custom protocol (`shared/mediaScheme.js`): the renderer never
  holds CDN URLs, `connect-src` lists no CDN hosts at all, and `media-src` only
  allows the scheme plus the self-decode `blob:`.
- The media proxy validates upstream hosts against a KuGou-CDN suffix
  allowlist (`kugou.com`, `kgimg.com`), upgrades `http:` sources to HTTPS per
  host (probe once per launch, HTTP remains the fallback only for concept-CDN
  hosts with mismatched certificates), and forwards Range headers so seeking
  works. Plain-HTTP exposure is therefore reduced to the main-process→CDN leg
  for those few hosts only. A smoke check for the protocol lives in
  `tools/smoke-media-proxy.mjs` (`npx electron tools/smoke-media-proxy.mjs`).
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
