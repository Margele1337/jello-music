# Jello Music

Clean-room, MIT-licensed desktop client for Kugou Music.

This repository is an independent implementation. It is **not** a fork of
MoeKoeMusic, MoeKoe-NextGen, or the legacy Jello Music GPL repository, and it
must not contain code copied from them.

- Legacy GPL-2.0 app (releases + source archive):
  https://github.com/Margele1337/jello-music-temp
- This repository: https://github.com/Margele1337/jello-music

## Status

Architecture foundation implemented:

- Electron 45 + Vue 3 + Vite 8, single secure main window
- `webSecurity: true`, `contextIsolation: true`, `nodeIntegration: false`,
  sandboxed renderer, minimal preload API
- Main-owned settings (`electron-store`) mirrored into Pinia; no localStorage
  settings copy; all IPC handlers validate the sender frame
- Vue Router, Pinia stores, and a stub `api:request` boundary for the future
  main-process API proxy
- `node:test` unit tests for settings sanitization and trusted-sender checks

Not implemented yet: Sigma UI, KuGouMusicApi sidecar, login, player, lyrics,
settings UI, updater.

## Development

Requires Node.js >= 20.19 on Windows.

```sh
npm install
npm run dev      # Vite + Electron
npm run build    # renderer production build
npm test         # unit tests
npm run dist     # Windows NSIS installer (electron-builder)
```

## Security baseline

- The renderer never gets Node.js access.
- `webSecurity` stays enabled; do not add `allowRunningInsecureContent`.
- Remote API/media access will go through a main-process proxy; the local
  sidecar will require a per-launch token.
- Keep a strict CSP and review it whenever a new origin is added.

## Third-party and provenance

- API sidecar (planned): [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi), MIT.
- Icon font (planned, when Sigma UI is integrated): Font Awesome Free
  (icons CC BY 4.0, fonts SIL OFL 1.1, code MIT).
- See [NOTICE](NOTICE), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
  [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).
