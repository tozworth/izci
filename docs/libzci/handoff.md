# Handoff — 2026-11-08

The user paused and then cleared the end-to-end goal, and requested packing up
for a new chat. Work is stopped, not complete. This is a checkpoint for a future
explicit continuation; it does not start work or recreate the cleared goal.

## Checkout and scope

- Workspace: `C:\Users\Toz\Projects\izci`, branch `libzci-codex`.
- Implementation checkpoint: `bbf1f570`; this handoff is a later docs-only commit.
- The worktree was clean at that checkpoint. No implementation was started after
  it: subsequent AVIF/provider-interface discussion was research and proposals.
- The original objective remains unfinished: finalize libzci, then move
  izci-server and the existing Svelte shells onto it. Neither adoption has begun.
- Follow [phases.md](phases.md) and the [readiness matrix](validation.md#adoption-readiness).
  Earlier historical phase labels are not completion evidence. Read current code
  and verify the relevant behavior before relying on previous reports.

## Current implementation

R1–M2 have substantial native/browser evidence, with target-specific acceptance
gaps retained in the roadmap. M3 is in progress. Both crude consumers exercise
catalog identities/facts, paged/grouped queries, managed scans, metadata/lyrics,
ReplayGain/R128, consumed-media play counts, artwork, image imports/scans,
captured image navigation and separate bounded rendition caches.

Recent coherent commits:

| Commit | Behavior |
| --- | --- |
| `ef29a81b` | Images enter the catalog/scans and are excluded from the music queue |
| `3b02523d` | Independent captured image navigation, generations and scoped visual cancellation |
| `68c37fdf` | Shared cache identity/integrity/LRU policy; separate native SQLite and browser IndexedDB caches |
| `bbf1f570` | Shared native/WASM JPEG XL decoding, catalog integration and reference-image checks |

Core image jobs currently decode PNG/JPEG/WebP/JPEG XL. Original images, embedded
artwork/lyrics, raw ICC, decoded RGBA and presentation surfaces remain transient.
The cache stores derived PNGs and bounded facts only. Defaults: 64 MiB / 256
entries; configurable hard limits: 256 MiB / 4096 entries. It resolves source
access and current revisions before serving cached pixels.

## Remaining work and caveats

1. Finish M3 acceptance, including AVIF, broader non-ICC/HDR color handling,
   and decoder resource budgets. Ordinary Open now content-routes images into
   the catalog and independent viewer in both crudes; catalog-only viewing is
   no longer the only path.
2. JPEG XL uses pinned `jxl` 0.8.0, first-frame still previews and straight-alpha
   8-bit output; CMYK is explicitly unsupported. Codestream orientation and
   reported output ICC pass a pinned orientation-5/BRG reference case. This is
   not full floating-point conformance or proof of a strict 128 MiB codec heap
   limit. Its internal ICC decompression ceiling is larger than the 1 MiB
   returned-profile limit. Hardening/measurement remains required.
3. AVIF research did not select or add a dependency/provider. A shared image
   codec-provider seam plus pinned reference native/WASM decoding was being
   considered; no interface, acquisition recipe or binding was implemented.
   Reassess this against actual source/API/resource behavior before proceeding.
4. Native open-job event and CLI profile-sync audits are fixed: rejected
   provider metadata emits `Failed`, stale work emits no terminal event, and
   `zci-play` retries/reports storage failures without cutting an active
   playback session. Final persistence failure is still surfaced after the
   normal media result.
5. Finish M4 (all eight Raf effects, presets/contextual loadouts, prepared
   playback and measured transitions), M5 (video), and M6 (C ABI, foreign caller,
   resource/failure/lifecycle readiness). Then A1 adopts the core in izci-server,
   and A2 replaces authority in the existing desktop/mobile/Oda Svelte shells.
6. Physical Android/background/grant and GNU/Linux evidence remains incomplete.
   Emulator/headless checks do not establish physical-device behavior.

The original izci runtime and user profiles/grants must be preserved until the
explicit adoption slices. The accepted libzci plan uses fresh Rust/SQLite state;
do not introduce legacy migrations or dual authorities. Keep domain policy in
core/services, not in crude or production components.

## Last verification, not rerun during packing

The implementation log records successful Windows MSVC checks on 2026-10-31:

- `cargo test --locked --manifest-path libzci/Cargo.toml --workspace`.
- Provider-enabled native image scans, core image/cache tests and crude-native
  viewer/controller tests. Device-access smoke remained ignored.
- Rebuilt control/audio WASM; crude PWA `typecheck`, `test:images`, `build`,
  seven audio-WASM ABI checks (`test`) and production `test:m3` cold-offline tests.
- Native lossless JXL pixels and upstream orientation/profile reference:
  at most one full-size 8-bit code-value difference; resized WASM: at most two.
- Real separate-cache reopen/eviction/corruption/revision checks. Denied-grant
  and quota rollback cases include explicit worker-realm fault injection, not
  physical permission revocation or disk exhaustion.

Local evidence JSON is under `.local/libzci/`, especially
`m3-images-evidence.json`, `m3-browser-evidence.json`, `m3-artwork-evidence.json`,
`m3-play-counts-evidence.json` and `m3-normalization-evidence.json`. These are
ignored artifacts, not portable proof. Recipes/tests and reference fixtures are
tracked; inspect [implementation-log.md](implementation-log.md) for detail.

## Local setup for continuation

From the repository root in PowerShell:

```powershell
$env:CARGO_HOME="$PWD/.local/desktop-toolchain/cargo"
$env:RUSTUP_HOME="$PWD/.local/desktop-toolchain/rustup"
$env:PATH="$env:CARGO_HOME/bin;$env:PATH"
. ./libzci/scripts/windows-toolchain.ps1
cargo test --locked --manifest-path libzci/Cargo.toml --workspace
python libzci/consumers/crude-pwa/scripts/build-wasm.py
```

Rust 1.98.1 and Emscripten 4.0.10 were used; pins/recipes live in
`libzci/vendor/dependencies.json` and `libzci/scripts/`. The WASM build requires
the wasm-bindgen CLI version matching `Cargo.lock`. Generated codecs, SDKs,
target output, fixtures generated during testing and browser profiles are under
ignored `.local/`, `libzci/target/` and consumer generated/build directories.
Some older tests need the generated media described in their recipes.

PWA npm commands run from `libzci/consumers/crude-pwa`. Browser tests share port
5197: run them sequentially, and build production assets before `test:m3`.
Do not edit browser source/generated WASM while its dev-server tests are running;
HMR can invalidate the evidence. No listener on 5197 or libzci cargo/rustc/player
process was found during packing. No task-owned process needed termination.

The prior user request authorized builds/tests/inspections with audio kept low.
Use muted Chromium (`--mute-audio`) and low master volume (tests use 0.02) when
resuming authorized work. Do not start routine builds merely to edit these docs.

Commit coherent milestones, keep `AGENTS.md` small, and preserve the original
scope. Update the roadmap/readiness evidence as behavior is actually proven.
