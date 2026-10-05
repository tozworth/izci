# crude PWA (Phase 1.3 proof page)

Browser consumer over the WASM engine: one engine worker (selection,
sessions, generations) plus one decode worker (File bytes, shared Ogg
demux, WebCodecs Opus). Plain HTML controls and diagnostic tables; no
design or UX budget spent here.

## Run

```sh
# from this directory
./scripts/build-wasm.sh   # compile libzci-web -> src/generated/ (ignored)
npm install
npm run dev               # serves on http://localhost:5197
```

`npm run build` emits the production bundle into `dist/` (own build
directory; never the root `dist/`). `npm test` runs the generation
protocol unit tests (node, no browser). `npm run typecheck` runs `tsc`.

## What the page does

File picker (real `File`, stays in the decode worker) → header handoff
→ engine `open` (real core provider selection) → bounded page-index
scan (synchronous `FileReaderSync` slices, one page body at a time) →
engine `commit-index` (shared validation, audible total) → engine
seek-plan → platform Opus decode with generation-tagged PCM →
engine ingest (stale generations refused) → snapshots and PCM stats.

Controls: open, play/pause/stop, seek (frames), dispose. The decode
table proves decode (frames, peak, RMS, read bounds); audible output
arrives in Phase 2.4 — this page stays silent by design.

## Independent identity

Dedicated port 5197, own Vite config and build directory, no shared
scope with the main izci app. No manifest, service worker, or install
support in this phase (those land in 3.4); do not register this page's
worker or scope from the main app or vice versa.

## Verification status (1.3)

- Host: `cargo test -p libzci-web` (engine generation fence, index
  commit, seek plans, demux splits); `npm test` (protocol helpers);
  `tsc`; `vite build`; `cargo check --target wasm32-unknown-unknown`.
- Browser execution (real File decode/seek vs native timing, bounded
  reads on the 30 s synth, worker error/cancel/reopen, Opus
  `AudioDecoder` description shape): pending — requires explicit
  browser-inspection authorization per the repo operating guide.
