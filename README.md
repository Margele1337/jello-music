# Jello Music

Clean-room, MIT-licensed desktop client for Kugou Music.

This repository is an independent implementation. It is **not** a fork of
MoeKoeMusic, MoeKoe-NextGen, or the legacy Jello Music GPL repository, and it
must not contain code copied from them.

- Legacy GPL-2.0 app (releases + source archive):
  https://github.com/Margele1337/jello-music-temp
- This repository: https://github.com/Margele1337/jello-music

## Status

Sigma player backed by the real KuGou API:

- Electron 45 + Vue 3 + Vite 8; secure main window plus an optional transparent
  desktop-lyrics window with its own narrow preload
- QR login with encrypted session persistence (`safeStorage`); cookies/token
  never reach the renderer
- Real search, public/user playlists, daily recommendations, queue playback,
  quality fallback (FLAC/320/128), in-app lyrics, desktop lyrics, tray mode,
  and quality/data-source settings
- KuGouMusicApi sidecar on a random loopback port; the renderer only uses the
  allowlisted `api:request` IPC proxy
- `electron-updater` wired to this repository's GitHub Releases; installer,
  sidecar, and update metadata are produced by `npm run dist`
- `node:test` coverage for settings, API policy, URL normalization, lyrics,
  desktop-lyric state, and trusted senders

Not implemented yet: phone/account login, a per-launch sidecar token, and code
signing. The interactive Electron runtime still needs a desktop-session check
(`npm run dev`).

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
- The sidecar is loopback-only on a random port; a per-launch token is still a
  follow-up.
- Keep a strict CSP and review it whenever a new origin is added.

## Third-party and provenance

- API sidecar: [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi), MIT
  (git submodule `api/`, LICENSE retained).
- Sigma UI font: Roboto, SIL Open Font License 1.1 (see
  `src/assets/sigma/fonts/OFL.txt`).
- See [NOTICE](NOTICE), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
  [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).
