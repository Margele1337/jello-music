# Jello Music

Clean-room, MIT-licensed desktop client for Kugou Music.

This repository is an independent implementation. It is **not** a fork of
MoeKoeMusic, MoeKoe-NextGen, or the legacy Jello Music GPL repository, and it
must not contain code copied from them.

- Legacy GPL-2.0 app (releases + source archive):
  https://github.com/Margele1337/jello-music-temp
- This repository: https://github.com/Margele1337/jello-music

## Status

Sigma UI demo with QR login wired to the MIT API sidecar:

- Electron 45 + Vue 3 + Vite 8, single secure main window
- `webSecurity: true`, `contextIsolation: true`, `nodeIntegration: false`,
  sandboxed renderer, minimal preload API
- Main-owned settings (`electron-store`) mirrored into Pinia; no localStorage
  settings copy; all IPC handlers validate the sender frame
- Sigma UI (owner-authored components/assets) with a mock player, local demo
  playlist/search, Roboto atlas font (SIL OFL) replacing Helvetica
- KuGouMusicApi sidecar launched by the main process on a random loopback port;
  renderer calls only the allowlisted `api:request` IPC proxy
- QR login page at `/login`; auth cookies/token stay in the main process
- `node:test` unit tests for settings sanitization, API policy, and
  trusted-sender checks

Not implemented yet: real playback/queue, lyrics, settings UI, updater,
phone/account login, persistent auth, and sidecar per-launch token. The
Electron window runtime still needs a local binary reinstall/verification.

## Development

Requires Node.js >= 20.19 on Windows.

```sh
npm run install-all   # root + MIT API submodule dependencies
npm run dev           # Vite + Electron + sidecar
npm run build         # renderer production build
npm test              # unit tests
npm run dist          # Windows NSIS installer (electron-builder)
```

## Security baseline

- The renderer never gets Node.js access.
- `webSecurity` stays enabled; do not add `allowRunningInsecureContent`.
- Remote API/media access will go through a main-process proxy; the local
  sidecar will require a per-launch token.
- Keep a strict CSP and review it whenever a new origin is added.

## Third-party and provenance

- API sidecar: [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi), MIT
  (git submodule `api/`, LICENSE retained).
- Sigma UI font: Roboto, SIL Open Font License 1.1 (see
  `src/assets/sigma/fonts/OFL.txt`).
- See [NOTICE](NOTICE), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
  [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).
