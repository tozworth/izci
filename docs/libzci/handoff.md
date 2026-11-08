# Handoff — 2026-11-09 (A2 first slice)

## Checkout and scope

- Workspace: `C:\Users\Toz\Projects\izci`, branch `libzci-codex`.
- Implementation commit: `d528fc2e` (`Route Svelte stream playback through libzci`).
- Worktree: clean after this documentation checkpoint; no task-owned preview,
  browser, Cargo or audio process should remain running.
- The MVP is **Svelte adoption with working playback for most existing formats**,
  not full parity with every research goal. A2 is now in progress; it is not
  complete.
- Follow [phases.md](phases.md), the
  [MVP readiness gate](validation.md#mvp-svelte-adoption-gate), and the current
  [implementation log](implementation-log.md). Historical phase labels are not
  completion evidence.

## Current implementation

R1–M3 have substantial native/browser evidence. M3 is complete for the MVP
scope. Both crudes exercise catalog identities/facts, paged/grouped queries,
managed scans, metadata/lyrics, ReplayGain/R128, consumed-media play counts,
artwork, image imports/scans, captured image navigation and separate bounded
rendition caches.

A2's first ownership slice is implemented in the production Svelte main window:

- Ordinary stream formats (`mp3`, `wav`, `flac`, `ogg`, `opus`) load and play
  through the libzci `WebEngine`, reference Opus/Symphonia providers, a bounded
  decode worker and the shared audio-only worklet.
- PCM is routed through the existing `audioBusService` source route. Master
  volume, transition/fade gain, the Raf compatibility graph, visualizer analyser
  and Media Session facade remain explicit shell-side bridges, not a second
  transport.
- Audible position comes from worklet consumption. Pause, seek, EOF, output
  backpressure, generation fences and Asyncify-safe decoder reads are wired.
- Seek rebuilds the generation-scoped `WebPreparation`; retained PCM/converter
  tails cannot cross the seek boundary.
- The old Howler transport, dependency, ambient types and test were removed.
  Tracker/Hively playback still uses the existing libopenmpt/Hively services,
  and video still uses the native `<video>` path.
- Ordinary-stream ReplayGain remains a shell-side shared-bus local-gain bridge.
  Global playback-rate changes for ordinary streams are not adopted yet and log
  an explicit warning; both are known temporary gaps.

Recent commits:

| Commit | Behavior |
| --- | --- |
| `d528fc2e` | Production Svelte ordinary-stream transport moved to libzci; Howler removed |
| `02dc264e` | Roadmap rescoped around Svelte MVP adoption |
| `d0f1589d` | Previous M3 continuation/evidence checkpoint |
| `bbf1f570` | Shared native/WASM JPEG XL and catalog/image adoption evidence |

## Remaining work and caveats

1. **Continue A2 in ownership slices.** Next is tracker/Hively transport through
   the same browser bridge while preserving subsong/pattern behavior. After that:
   queue/library/catalog and file-access authority, lyrics/artwork/details,
   window bindings, then mobile/Oda presentation wiring.
2. **Extract the shared browser runtime from the crude consumer.** The new
   production bridge currently imports generated control/audio/codec assets and
   provider helpers under `libzci/consumers/crude-pwa/src/`. This is one owner
   and one transport, but the shared runtime should move to a proper reusable
   location before A2 closes.
3. **Close explicit compatibility gaps before claiming parity:** ordinary-stream
   playback rate, full core normalization/ReplayGain ownership, and any
   crossfade/prepared-source behavior not yet re-evidenced on the new backend.
4. **Preserve the browser video path.** `VideoPlayerService` remains the
   presentation-owned native `<video>` implementation. Core video is post-MVP.
5. AVIF, broader HDR/color handling and formal image-decoder heap accounting
   remain post-MVP backlog. Full Raf parity/loadouts/gapless work, C ABI,
   izci-server adoption, physical Android/background and GNU/Linux stay
   post-MVP unless the user reprioritizes them.

## Last verification (not rerun while packing docs)

Windows x64, muted headless Chromium, production `dist/` served from a temporary
local preview:

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 229 files / 1,455 tests passed.
- `npm run build`: passed. PWA precache: 171 entries, including emitted
  `libzci_web_bg`, `libzci_audio_web` and `opus-reference` WASM plus the worker
  and output worklet.
- Real `44100-1.flac`, `44100-1.mp3`, `44100-1.ogg`, `44100-1.wav` and
  `48000-2.wav`: playback advanced; pause held position; seek to 1.5 s landed;
  resume advanced to about 2.0–2.2 s; no page or console errors.
- Real 30 s `long.opus`: playback advanced; pause held; seek to 15 s landed;
  resume advanced to 15.8 s; no errors.
- `snapshot.test.ts` covers core state vocabulary and frame-to-time mapping.

These are foreground headless results. They do not establish physical
Android/background, GNU/Linux, installed-PWA lifecycle, or long-duration
ownership-loss behavior for the adopted path.

## Local setup for continuation

From the repository root in PowerShell:

```powershell
$env:CARGO_HOME="$PWD/.local/desktop-toolchain/cargo"
$env:RUSTUP_HOME="$PWD/.local/desktop-toolchain/rustup"
$env:PATH="$env:CARGO_HOME/bin;$env:PATH"
. ./libzci/scripts/windows-toolchain.ps1
python libzci/scripts/build-browser-codecs.py
python libzci/scripts/build-browser-modules.py
python libzci/consumers/crude-pwa/scripts/build-wasm.py
npm run check
npm test
npm run build
```

The production shell imports generated browser assets from
`libzci/consumers/crude-pwa/src/generated/`; those files are ignored and must be
built before a clean `npm run build`. Rust 1.98.1, Emscripten 4.0.10 and the
matching wasm-bindgen CLI are recorded in the implementation log and vendor
pins. Local audio fixtures live under `.local/libzci/media/` and
`C:\Users\Toz\Music\izci-tests`.

For browser checks, build first, serve `dist/` on a temporary port, use muted
Chromium/Helium, and stop the preview server afterward. Do not edit generated
WASM or browser source while an evidence run is active. Preserve ordinary izci
profiles/grants; this adoption uses the same application origin but has not yet
migrated queue/library persistence.

Commit coherent A2 slices. Record actual browser interactions and measurements
in the implementation log; do not infer a closed milestone from typecheck or a
single short fixture.
