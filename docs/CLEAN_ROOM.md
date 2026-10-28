# Clean-room provenance

This repository is an independent, MIT-licensed implementation. The legacy
GPL-2.0 app lives at:

https://github.com/Margele1337/jello-music-temp

Its releases and source are retained there. Do not delete that repository
while GPL-2.0 binaries or source obligations remain relevant.

## Baseline analysis

The legacy repository imported a MoeKoe-NextGen snapshot at commit
`d5bcaad` (2026-09-18, package version 1.6.9). A file-level comparison of
that import with the later legacy HEAD found:

- 215 files in the imported baseline
- 118 files added after the import
- 84 files modified after the import
- 94 files deleted after the import
- 37 files unchanged since the import

Conservative classification for this clean-room project:

- **Not reusable:** every file present in the `d5bcaad` baseline, including
  modified and unchanged files, and rewrites of the same functionality
  (player, queue, login, settings, lyrics, Electron windows/services).
- **Candidate reusable after review:** original Sigma UI components, Sigma
  assets, font-atlas tooling, and standalone tools authored by the repository
  owner, provided they contain no upstream-derived code.
- **Third-party:** KuGouMusicApi (MIT), Font Awesome (CC BY 4.0 / SIL OFL 1.1 /
  MIT), and other MIT/Apache dependencies with their notices.

## Rules

1. Do not copy code, comments, file structure, or GPL/MoeKoe-derived assets
   from MoeKoeMusic, MoeKoe-NextGen, or `jello-music-temp` into this repository.
   Owner-authored Jello/Sigma branding assets may be reused only when the owner
   confirms authorship and records the relicensing in the provenance log.
2. Implement from behavior specifications, public API documentation, and
   original design work.
3. Reusing owner-authored Sigma code is allowed only after confirming it is
   original and does not incorporate upstream code.
4. Do not bundle proprietary fonts such as Helvetica Neue without a license.
   Use an open font (Inter, Roboto, Noto Sans) and regenerate any font atlases.
5. Verify Sigma assets: use only assets you own or that are licensed for
   redistribution; replace Minecraft or other third-party assets otherwise.
6. Keep third-party licenses in `NOTICE` and the corresponding package files.
7. Record provenance for each imported module: source, author, license, date,
   and reviewer.

## Provenance log

| Module | Source | License | Date | Reviewer |
| --- | --- | --- | --- | --- |
| Electron/Vue/Vite skeleton | Original work | MIT | 2026-10-27 | — |
| Sigma UI components/assets | Owner-authored sigmarebase work (ported from the legacy repo's Sigma UI) | MIT (owner) | 2026-10-27 | Owner review |
| Roboto atlas font | Google Fonts / google/fonts | SIL OFL 1.1 | 2026-10-27 | Import check |
| Selawik atlas font | microsoft/Selawik (Segoe UI metric-compatible, regenerated via tools/font-atlas) | SIL OFL 1.1 | 2026-10-28 | Import check |
| KuGouMusicApi sidecar | MakcRe/KuGouMusicApi | MIT | 2026-10-27 | Import check |
| Jello/Sigma app & tray icon | Owner-authored Jello branding (stored in the legacy repo) | MIT (owner-authorized) | 2026-10-28 | Owner |
| Spectrum HUD / FFT / AudioWorklet | Owner-authored sigmarebase spectrum (ported from the legacy repo with owner authorization) | MIT (owner-authorized) | 2026-10-28 | Owner |
| Right-Shift dock / slide behavior | Owner-authored Jello/Sigma UI behavior (reimplemented for the clean-room window) | MIT | 2026-10-28 | Owner |
| Desktop lyrics karaoke window | Owner-authored desktop-lyrics feature (behavior port: lock/drag/resize, per-char KRC karaoke, colors; reimplemented on the clean-room preload bridge) | MIT | 2026-10-28 | Owner |

## Limits

A file-level diff is not a legal clearance. Rewriting after having seen GPL
code is not a formal clean-room; keep independent specifications, avoid
copying, and consult a lawyer before a public/commercial release.
