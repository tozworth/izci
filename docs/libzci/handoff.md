# Handoff — 2026-11-09 (A2 forty-fifth slice)

## Checkout and scope

- Workspace: `C:\Users\Toz\Projects\izci`, branch `libzci-codex`.
- Implementation commit: `39b24796` (`Add stub profile owner worker for A2`).
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

A2's transport slices are implemented in the production Svelte main window
(same as the third slice, unchanged since):

- Ordinary stream formats (`mp3`, `wav`, `flac`, `ogg`, `opus`), OpenMPT
  tracker modules (`mod`, `xm`, `s3m`, `it`, `mo3`) and Hively modules (`ahx`,
  `hvl`) load and play through the libzci `WebEngine`, reference
  Opus/Symphonia/modules-reference providers, a bounded decode worker and the
  shared audio-only worklet. Both Svelte transports share one engine-link
  runtime; generated WASM now emits to workspace-ignored `libzci/generated/`.
- PCM is routed through the existing `audioBusService` source route. Master
  volume, transition/fade gain, the Raf compatibility graph, visualizer analyser
  and Media Session facade remain explicit shell-side bridges, not a second
  transport. Video stays on the native `<video>` path (M5 deferred); Raf stays
  shell-side with an explicit `auto-amp` video bypass (M4 deferred).
- The old Howler transport, dependency, ambient types and test were removed.
  The legacy OpenMPT and Hively audio transports are superseded (OpenMPT
  pattern songs still use the legacy inspection worker; Hively pattern songs
  use output-free replay-core inspection).

Since then, forty-four pure Svelte seams plus the first stub worker file pin
the queue/library adoption contract (all typechecked, unit-tested, built; no
browser run claims for the worker yet):

- Queue: snapshot probe + read-only facade (+ `catalog_revision`), command
  boundary (all 12 `QueueCommand`s, settings mapping), durable request ids
  (revision-prefixed + 128-revision window), live-`File` source registry,
  `QueueLoad` → playback resolution (`access-required` vs `unsupported`),
  Svelte→core settings mapping, transport guards.
- Catalog/library: snapshot probe + read-only facade (rating `0..10` →
  half-star), user-facts commands (favorite/rate/bookmark/remove) + rating
  mapping, query boundary, groups boundary + view mapping (years/folders
  shell-side), bookmarks boundary + sorting, image-sequence boundary +
  stepping, managed scan-roots boundary + folder mapping, root command
  builders, capability stage keys, ingest request boundary, scan observation,
  rendition requests, lyrics documents + active-cue lookup, play-count and
  normalization observations.
- Owner client (document side, no worker file yet): queue + catalog mutate +
  catalog_query + catalog_groups + bookmarks + image_sequence + roots +
  begin_scan + cancel_scan + finish_scan + ingest + restore through one shared
  32-request table, with snapshot → queue-facade (+ `access`/`scan` tracking)
  and catalog-page → catalog-facade routing; unified profile store composes
  facades + registry + client + `access`/`scan` readables; worker protocol
  pins all seventeen channels (including lifecycle: ingest/restore/attach/
  context/ack/output-error).
- Profile ownership: fresh `izci-v1` namespaces (OPFS/channel/lock/IDB) with
  name validation, access contract + UI-action mapping, transport guards.
- Explicit bridges: native-video + shell-Raf + playback-gap registry +
  mobile/Oda/window consumer contract.

Recent commits (this session, oldest first):

| Commit | Behavior |
| --- | --- |
| `7c618b52` | Pin Svelte core queue command boundary |
| `6be34c65` | Declare explicit video/Raf bridges |
| `7be634cc` | Source registry, catalog observation, owner-client wire |
| `93d9e6c9` | Catalog user-facts command boundary |
| `265c4d5b` | Svelte→core settings mapping |
| `015006d4` / `1e4da352` / `b8afeb29` | Owner catalog mutate/query/groups channels |
| `b08991ce` / `cdbeab07` | Catalog query/groups boundaries |
| `f989de3f` / `e569eca6` / `fd38adfc` / `afeda083` | Owner bookmarks/image/roots/scan channels |
| `9bb67768` | QueueLoad → playback resolution |
| `bb64b4e1` / `c8f716cf` | Bookmarks/image-sequence boundaries |
| `d2ca0c62` / `2a442f80` | Scan roots boundary + root command builders |
| `8660847f` / `421fc304` | Capability keys + ingest request boundary |
| `cc01e530` / `47cd1e8b` / `1d6ba791` | Play-count/normalization/lyrics boundaries |
| `b19934ef` | Queue observation carries catalog revision |
| `1f9c2349` / `e65e3d92` | Worker protocol + unified profile store |
| `8b224a4b` / `c7ee9f53` / `2247043a` | Durable ids + access contract/wiring |
| `c371c37c` / `40e40a15` | Scan observation boundary + wiring |
| `5f746b2c` | Rendition request boundary |
| `83b7c4e1` / `c2d2ca8c` | Profile namespaces + transport guards |
| `7cfe2907` / `4dc71e09` / `0afdffe4` | Worker lifecycle channels + owner ingest/restore |
| `afe27103` | Scan batch bounds |
| `39b24796` | Stub profile owner worker + spawn helper |

## Remaining work and caveats

1. **Grow the stub worker into the live owner.** The validating-only
   `profile-owner.worker.ts` + `spawnProfileOwnerWorker` exist but own no
   storage yet (no chunk emitted; nothing references the spawn helper in
   production). Next: `openDatabase`/`WebProfile`/`Capabilities` behind the
   pinned `izci-v1` names (needs the `@sqlite.org/sqlite-wasm` dependency
   decision), Web-Lock + BroadcastChannel election, `profile-init`/`attach`,
   ingest (`ingest-request` + staging/completion/GC), restore/
   materialization (`QueueLoad` → `resolveQueuePlayback` → transport),
   checkpoints (2 s throttle + play-count `syncPlayback`), and scan
   execution (probe `MediaInput`/`Metadata` normalization, `stage_scan`,
   enumeration, reconciliation). Start profile-only (no AudioContext), then
   attach transport; wire the first construction site so the chunk appears.
2. **Cut over persistence and file access.** OPFS profile as truth (Svelte
   IDBs become migration sources/read caches); real `File`/FSA/native access
   with one profile owner; staged scans reconciling only their root; orphan
   recovery. Fresh libzci state, no old-state conversion.
3. **Wire the remaining domain.** Metadata normalization at probe time,
   lyrics/artwork/image jobs + rendition cache + viewer navigation
   (`lyrics-document`, `image-sequence`), play-count/normalization sync from
   observations, transport wiring from resolved loads, groups/scan/bookmark
   execution, `Add` media builder (needs probe `Metadata`).
4. **Close explicit compatibility gaps before claiming parity:** ordinary-stream
   playback rate, Hively tempo/pitch/repeat, full core normalization/ReplayGain
   ownership, and any crossfade/prepared-source behavior not yet re-evidenced
   on the new backend. Video stays native `<video>` (M5 deferred); Raf stays
   shell-side (M4 deferred).
5. AVIF, broader HDR/color handling and formal image-decoder heap accounting
   remain post-MVP backlog. Full Raf parity/loadouts/gapless work, C ABI,
   izci-server adoption, physical Android/background and GNU/Linux stay
   post-MVP unless the user reprioritizes them.

## Last verification (rerun for the forty-fifth slice)

Windows x64 (no browser, no device for the pure seams + stub worker; transport
evidence below is retained history, not rerun):

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 261 files / 1,553 tests passed.
- `npm run build`: passed. PWA precache: 172 entries, unchanged (stub worker
  unreferenced; chunk lands with the first construction site).
- Focused vitest (`profile-owner`): 2 passed.
- Retained transport history (muted headless Chromium, production `dist/`
  preview): `tone.ahx`/`tone.hvl`/`tone.mod`/`44100-1.mp3` play/pause/seek/
  resume with no page/console errors; `snapshot.test.ts` + Hively inspection
  coverage.

Pure-seam results do not establish physical Android/background, GNU/Linux,
installed-PWA lifecycle, or long-duration ownership-loss behavior for the
adopted path; the live worker + real-file playback evidence remain the A2
gate.

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
`libzci/generated/`; those files are ignored and must be
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
