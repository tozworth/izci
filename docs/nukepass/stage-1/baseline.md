# Stage 1 clean-start baseline

## Identity and environment

The baseline was captured on 2026-08-12 before Stage 1 repository changes.

| Fact | Value |
| --- | --- |
| Branch | `nukepass`, tracking `origin/nukepass` |
| Commit | `57361c059a27f3a4b528d57dda83fa2230edbf88` |
| Recovery oracle | `nukepass-oracle-2026-08-12` at `33a7ca8` |
| Lockfile SHA-256 | `36de52cbfa35598ae6117151513e3ac60a6f27315001976c249df52707995b2d` |
| OS | Ubuntu kernel `7.0.0-28-generic`, x86-64 |
| Hardware class | AMD Ryzen 5 5600H, 6 cores / 12 threads |
| Node / npm | `v22.22.2` / `10.9.7` |
| Browser candidate | `/opt/apps/Helium.AppImage`; exact version is recorded by the CDP run |

`npm ci` completed from the committed lockfile. The first command dispatch raced
the install's final link population and produced non-evidence `command not
found` results; the commands below were rerun after install completion and are
the accepted baseline. No tracked file changed during install or prebuild.

## Required commands

| Command | Result | Recorded facts |
| --- | --- | --- |
| `npm test` | pass | 138 files; 636 passed, 7 skipped; 643 total; 13.95 s |
| `npm run check` | pass | 0 errors, 0 warnings |
| `npm run i18n:validate` | pass | catalogs current; no files changed |
| `npm run multiplayer:protocol:check` | pass | protocol and Firebase rules synchronized |
| `npm run test:firebase-rules` | pass | emulator 4.11.2; 1 file / 8 tests; 7 normal-suite skips thereby exercised |
| `npm run build` | pass | Vite 7.3.5; 600 modules; 9.89 s; Workbox 91 entries / 7845.60 KiB |

The seven ordinary-suite skips are the Firebase rules cases guarded by
`describe.skip` when `FIREBASE_DATABASE_EMULATOR_HOST` is absent. The dedicated
emulator command runs all eight current rules tests.

## Warnings and known baseline facts

- Firebase Tools emits Node's `DEP0040` warning for its transitive `punycode`
  use. It does not originate in application code.
- Vite warns that chunks over 500 kB exist. The emitted large JavaScript assets
  include `main` (563,078 B), the Multiplayer render worker (545,350 B), the
  Converter worker (1,222,305 B), and the emitted libopenmpt worklet runtime
  (1,774,814 B). This is measured baseline pressure, not a Stage 1 optimization
  target.
- Eight HTML entrypoints were emitted: main, Options, Audio Compare, Editor,
  Converter, Logs, Troubadour, and Troubadour Options.
- Required special assets were emitted: Chiptune3 and libopenmpt worklets,
  module/Multiplayer/Converter workers, Hively worklet and WASM, manifest,
  service worker, Workbox runtime, icons, and the local Material Symbols font.
- The build generated 91 precache entries totaling 7,845.60 KiB. The checked-in
  build reporter added later in this stage records the exact sorted asset and
  precache manifests rather than relying on this prose summary.
- Startup console/runtime/network output remains pending until the checked-in
  CDP harness exists. It will be appended as browser evidence against this same
  behavioral baseline before the Stage 1 gate is accepted.

## Baseline disposition

All required deterministic, type/localization, protocol, Firebase-emulator, and
production-build gates are green. Current chunk-size and Firebase deprecation
warnings are carried as explicit baseline observations. There is no prerequisite
application repair before characterization work begins.
