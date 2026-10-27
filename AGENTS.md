# Agent Guide

## Clean-room rule

This is an MIT clean-room repository. Never copy code, comments, assets, or
file structure from:

- `MoeKoeMusic/MoeKoeMusic`
- `xuxin1337/MoeKoe-NextGen` (legacy)
- `Margele1337/jello-music-temp` (legacy GPL app)

Implement from behavior specifications and original code. If a module is
ported from the owner's own sigmarebase project, document the provenance and
review asset/font licenses first.

## Third-party

- Prefer MIT/Apache dependencies.
- Keep `NOTICE` and license files current when adding code or assets.
- Do not bundle proprietary fonts or game assets.

## Verification

- Run `npm run build` before committing.
- Add tests for pure logic and critical flows as modules land.
- Do not add `webSecurity: false` or `allowRunningInsecureContent`.

## Git

Commit and push verified changes to this repository. Do not push this project's
code to the legacy GPL repository, and do not push legacy GPL code here.
