# Stage 0 execution checkpoint

Recorded on 2026-08-12 in the `nukepass` branch.

## Behavioral oracle and recovery

| Fact | Frozen value |
| --- | --- |
| Accepted `main` commit | `33a7ca8906a76d85e0b9fe10d0eeb48d739f9248` (`Bump to 0.3.2`) |
| Recovery tag | `nukepass-oracle-2026-08-12` (annotated; peels to the accepted `main` commit) |
| Integration branch | `nukepass` |
| First branch-only commit | `98f1ec0ebed6d9d8844fecba8ba8b2999a1fdc9f` (`Add initial nukepass bible`) |
| Application version | `0.3.2` |
| Lockfile SHA-256 | `36de52cbfa35598ae6117151513e3ac60a6f27315001976c249df52707995b2d` |
| Multiplayer protocol | `18` from `MULTIPLAYER_PROTOCOL_VERSION` |
| Firebase rules SHA-256 | `bd2122426c195c0b3fd3fc02754358f4ed57c4395ae13fade19f1527056b965c` |
| Protocol/rules relation | Both room and host-directory validation require protocol `18`; `npm run multiplayer:protocol:check` is the non-writing guard |

The oracle is the product behavior reference, not an implementation dependency.
Recovery means returning to the tagged commit or abandoning an isolated failed
slice. It does not mean layering an adapter onto an unproven replacement.

## Multiplayer checkpoint decision

All accepted Multiplayer work already belongs to the oracle: the merge base of
`main` and `nukepass` is the exact accepted `main` commit, and the only initial
branch-only commit is the nukepass runbook. Protocol 18, its Firebase validation,
the bounded render disk cache, Co-op, hosted audio, source delivery, buffered
Opus, live RTP audio for video sources, reconnect/restore, and Freeplay are therefore
frozen as desired behavior.

There will be no rolling merge of Multiplayer changes from another branch.
Further Multiplayer work must be an explicitly owned nukepass slice. A protocol
change must move protocol source, validation/decoder, Firebase rule facts, and
tests in one checkpoint; no compatibility adapter is retained.

## PWA manifest facts at the oracle

- Eight build entries: main, Options, Audio Compare, Editor, Converter, Logs,
  Troubadour, and Troubadour Options.
- Standalone display with `window-controls-overlay` preferred, `/` start URL and
  scope, and `focus-existing` launch handling.
- Two SVG application icons plus the PNG file-handler icon.
- Conservative file associations: MP3, WAV, FLAC, Ogg/Opus, MOD/XM/S3M/IT/MO3,
  AHX/HVL, MP4/M4V/MOV, WebM, and MKV.
- Workbox precaches built JavaScript, CSS, HTML, SVG, PNG, WOFF2, MEM, WASM, and
  TXT assets up to 4 MiB. Navigation fallback excludes the seven non-main HTML
  entry paths.
- Service-worker registration is production-only in application bootstrap code.
- The Chiptune3 `libopenmpt.worklet.js` asset is emitted unchanged at its fixed
  runtime path.

Generated artifact names, sizes, precache entries, manifest contents, and actual
startup behavior are Stage 1 evidence rather than inferred here from config.

## Supported versus associated formats

Internal support intentionally exceeds manifest association. Stream support is
MP3, WAV, FLAC, Ogg, and Opus; video support is MP4, M4V, MOV, WebM, and MKV;
Hively support is AHX/HVL. OpenMPT's internal module allowlist additionally
contains MPTM and dozens of legacy tracker/container extensions declared by
`MODULE_EXTENSIONS` in `src/lib/types.ts`.

The manifest associates only MOD, XM, S3M, IT, and MO3 from the OpenMPT set,
plus every declared stream/video/Hively extension. This difference is a safety
policy and is not drift to “fix” by making the lists identical.

## Execution constraints

- No source implementation changes begin until the Stage 0 ledgers pass their
  cross-check and every missing owner is recorded as a defect.
- No external feature branch is merged continuously into this branch.
- Required build and verification commands are recorded against exact commits.
- Installed-PWA, OS file-handler, physical-audio, Android, and real-network
  claims remain manual/device residuals; a browser tab cannot certify them.
