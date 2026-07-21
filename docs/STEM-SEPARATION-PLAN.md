# Stem Separation Experiment — Goldilocks Plan v0

Status: implemented as an opt-in pre-alpha experiment; installed-PWA audio/GPU validation remains manual.

## Implementation revision

The implementation deliberately drops the highest-risk four-channel playback assumption. Chromium keeps the original Howler HTML media element as the transport and a second, synchronized stereo float32 WAV media element carries only the estimated vocal signal. Both are adopted into a focused Web Audio mixer before ReplayGain, Raf, and the analyser. The gain law is unchanged, so center remains the original element, the left endpoint is `original - vocal`, and the right endpoint is vocal.

This costs more derived storage than FLAC, but avoids speaker-layout remapping and preserves out-of-range vocal samples needed for clean subtraction. The 2 GiB result LRU remains in force. Playback route failure keeps the original stream route. The dual-element synchronization path still needs installed-PWA stress testing for seeking, rapid track changes, suspension, and long-run drift.

The checked-in implementation also includes:

- a pinned BS PolarFormer WebGPU FP16 payload revision, byte count, and SHA-256;
- `npm run optional:stems` to fetch and verify the deployment artifact without committing 108 MB to Git;
- a dedicated ONNX/STFT worker with one-job cancellation by worker termination;
- separate IndexedDB/OPFS runtime and result storage with commit-last metadata and LRU pruning;
- Options -> Experimental installation, diagnostics, cleanup, and feature gating;
- a current-track prepare/progress/cancel/reprocess/delete popover; and
- English and Turkish UI strings.

## Short verdict

Build this as an opt-in experiment with a versioned processing payload downloaded on first enable.

The first version should:

- support stream tracks only;
- process one track explicitly in the background;
- use BS PolarFormer FP16 through izci's pinned ONNX Runtime Web/WebGPU implementation;
- cache a stereo float32 WAV playback asset containing the estimated vocal L/R signal;
- keep Howler's original HTML5 media element as the transport and synchronize a second vocal element;
- derive instrumental and vocal emphasis in a small Web Audio mixer before ReplayGain, Raf, and the analyser;
- fall back to original playback when the required routed Web Audio path is unavailable;
- keep the optional model/runtime payload and generated stems outside playlist/library records; and
- download only izci-owned, same-origin, versioned artifacts with compiled-in sizes and digests.

The highest remaining playback risk is whether two media elements remain aligned through seeking, suspension, and long playback. Installed-PWA stress testing is still required.

## Product contract

### User-visible promise

Once a stream track has been prepared, expose one control:

```text
Instrumental  <———  Original  ———>  Vocals
```

The center is the decoded original. The left endpoint removes the estimated vocal stem. The right endpoint isolates the estimated vocal stem. Intermediate positions are continuous and smoothed.

Suggested interaction:

1. The experiment is off by default.
2. Enabling it creates Options -> Experimental, runs a WebGPU/storage preflight, and offers the one-time optional download with an exact size.
3. A stem icon appears for eligible stream tracks.
4. Before processing, its popover offers **Prepare this track**, an honest storage estimate, and a cancel button once work starts.
5. After processing, the same popover contains only the three-anchor slider, a reset-to-center action, **Reprocess**, and **Delete cached stems**.
6. Track and library context-menu entry points may be added after the current-track flow works; batch queues are not v1.

Recommended behavior is to retain the slider value for the session so a karaoke preference can carry across already-prepared tracks. Keep it out of `PlaylistItem`. When a track has no prepared result, play the original and clearly show that the control is unavailable.

### V1 scope

- Preprocess stream tracks into a two-way vocal/instrumental control.
- Process one explicitly selected track at a time.
- Keep the complete processing and playback path local after the one-time payload download.
- Request File System Access permission only from the explicit prepare action.
- Keep tracker-module playback unchanged.
- Store runtime and derived-audio data in dedicated storage, outside playlist/library records.
- Keep the optional model and heavy runtime code outside the normal Workbox precache.

## Audio graph placement

Raf owns cheap, live, reversible DSP on the shared real-time graph. Separation is a long-running content transformation with model installation, GPU scheduling, cancellation, persistent derived files, cache eviction, provenance, and failure recovery.

The only real-time part is the final two-signal mixer. That mixer belongs to the prepared stream source, before the existing audio-bus ingress:

```text
normal stream:
Howler HTML5 media element -> audio-bus ingress/ReplayGain -> Raf -> analyser -> master -> destination

prepared stream:
Howler original media element + synchronized vocal float32 WAV element
  -> two-signal stem mixer
  -> audio-bus ingress/ReplayGain
  -> Raf
  -> analyser
  -> master
  -> destination

module:
Chiptune3/libopenmpt -> audio-bus ingress -> Raf -> analyser -> master -> destination
```

Stem state remains independent of Raf presets, and the stem mixer remains active when Raf is bypassed.

## Core playback design

### Prepared signal layout

The prepared asset stores the stereo estimated vocal signal. The original remains the normal source file owned by Howler:

```text
original element: decoded original left/right
vocal element: estimated vocal left/right
```

For slider value `x` in `[-1, 1]`:

```text
x <= 0: output = original + x * vocal
x >= 0: output = (1 - x) * original + x * vocal
```

Therefore:

- `x = -1`: `original - vocal` (instrumental estimate);
- `x = 0`: original;
- `x = 1`: vocal estimate.

This keeps the center on the actual original playback path and makes the instrumental side the exact complement of the cached vocal estimate.

Smooth gain changes over roughly 20–40 ms. During preprocessing, calculate a small peak-compensation lookup across the slider range so endpoint or intermediate mixes do not clip when phase cancellation in the original had hidden a loud stem peak. Apply attenuation only where headroom is required.

### Preserve Howler ownership

Howler still owns load/play/pause/seek/end/progress through its original HTML media element in `html5: true` mode. The prepared vocal element is a synchronized signal source, not a third playback backend.

Introduce an ephemeral playback-asset description rather than mutating `PlaylistItem`:

```ts
type StreamPlaybackAsset =
  | { kind: 'original'; url: string; format: string }
  | { kind: 'vocal-balance'; url: string; format: 'wav-f32'; cacheKey: string };
```

`HowlerPlayerService` remains the transport owner. It asks a focused routing object to adopt the element after load:

- normal asset: existing media-element source -> audio bus;
- prepared asset: original and vocal media-element sources -> two-signal mixer -> audio bus.

`AudioBusService` will need a safe way to create/reuse a `MediaElementAudioSourceNode` without immediately connecting it, then connect the mixer output as the active source. The normal convenience path should remain intact.

For a prepared asset, both elements must be adopted into Web Audio successfully. If either source or the shared context fails, disconnect the prepared route and reconnect the original source directly.

### Mandatory playback spike

Before integrating ONNX Runtime or building download UI, generate a tiny deterministic four-channel test file with distinct impulses and prove all of the following in current Chromium:

- lossless multichannel FLAC encoding is available from an app-owned, pinned encoder;
- `HTMLMediaElement` can load, play, pause, and accurately seek the object URL;
- Howler remains in HTML5 mode and reports correct duration/progress;
- `MediaElementAudioSourceNode` exposes four channels without speaker-layout remapping;
- a `ChannelSplitterNode` with discrete interpretation receives the expected four impulses;
- center output is sample-identical to the first stereo pair after FLAC decode;
- repeated seek/play/pause operations do not swap, downmix, or drop channels;
- an OPFS-backed `File` can be reopened and played after a full offline PWA restart; and
- route failure falls back to the original before any malformed multichannel audio is audible.

If four-channel FLAC fails, use a small PCM WAV diagnostic to identify whether the failure is the encoder/container or multichannel media routing. A failed routing gate requires a revised playback design before Phase 3.

## Separation pipeline

### Recommended first model

Start with BS PolarFormer FP16. Its published browser-oriented export is approximately 103 MB, accepts stereo 44.1 kHz STFT features, outputs a complex vocal mask, and matches the two-way control in this plan.

Treat that choice as provisional until the spike verifies:

- the exact model artifact digest;
- checkpoint and derivative-license provenance, not just the model-card label;
- the JavaScript STFT/iSTFT implementation against the reference script;
- verified WebGPU execution;
- output quality on izci's representative material; and
- compositor/audio behavior while playback and the visualizer are active.

### Processing lifecycle

```text
explicit user action
  -> ensureLoaded(track id, prompt allowed because this is a user gesture)
  -> WebGPU, payload, and storage preflight
  -> source fingerprint
  -> cache lookup
  -> decode to 44.1 kHz stereo PCM
  -> send bounded overlapping windows to one long-lived worker
  -> JS/WASM STFT
  -> pinned ONNX model on WebGPU
  -> complex vocal mask
  -> iSTFT and overlap-add
  -> encode vocal L/R to stereo float32 WAV
  -> finalize OPFS temporary asset
  -> calculate verification/peak metadata
  -> commit the IndexedDB cache record last
```

Use a dedicated app-owned worker with a protocol limited to PCM windows, progress, cancellation, and inference results. Track materialization, storage, and network access remain host-owned.

Decode through a throwaway 44.1 kHz `OfflineAudioContext` so the model input rate is deterministic. Keep the decoded `AudioBuffer` in the host and transfer bounded overlapping windows to the worker. This still has a full-track PCM memory cost, so v1 needs a duration/memory preflight and a conservative maximum until measurements replace guesses.

Only one inference job may run at a time. Yield between windows and drain the WebGPU queue where supported. Cancellation must be checked between decode, model windows, overlap-add, and encoder writes. A cancelled or failed job leaves no committed cache record.

### Execution-provider policy

V1 requires WebGPU plus shader-f16. Devices without them receive an explicit unsupported state; WASM/CPU execution is not offered.

Set and expose the requested execution provider, record the provider actually used where the runtime permits it, and include a small known-answer inference in payload validation. Measure and document any internally CPU-routed nodes.

Handle device loss as a normal job failure. Dispose all tensors and sessions after cancellation/failure. Keep one session warm only while there is useful work, with an idle timeout so the GPU allocation does not live forever.

## Optional payload delivery

### What ships where

The normal client download and service-worker precache contain only:

- the experiment toggle and small download-state UI;
- feature detection and payload metadata constants;
- the current-track/cache orchestration needed to explain availability; and
- a dynamic import boundary for the heavy processing implementation.

The complete static deployment still contains the lazy JavaScript chunk and exposes one versioned, same-origin payload namespace, for example:

```text
/optional/stem-separation/v1/bs_polarformer_fp16.onnx
/optional/stem-separation/v1/ort-wasm-<pinned-variant>.wasm
```

The compiled application owns immutable metadata for each artifact:

```ts
const STEM_PAYLOAD = {
  version: 1,
  modelUrl: '/optional/stem-separation/v1/bs_polarformer_fp16.onnx',
  modelBytes: 0, // placeholder; the real value must be exact
  modelSha256: '...',
  runtimeUrl: '/optional/stem-separation/v1/ort-wasm-<pinned-variant>.wasm',
  runtimeBytes: 0,
  runtimeSha256: '...'
} as const;
```

A new model/runtime combination receives a new payload version in izci's source and static deployment.

### First-enable flow

1. The user turns on **Stem separation** under Options -> Experimental.
2. izci checks WebGPU/shader-f16 support and calls `navigator.storage.estimate()`.
3. If the payload is absent, the UI states the exact download and installed-storage sizes and asks to continue.
4. izci downloads same-origin artifacts with streaming progress, verifies byte count and SHA-256, and writes temporary OPFS files.
5. IndexedDB installation metadata is committed last. Failed or cancelled downloads never become installed.
6. A small known-answer inference verifies that the pinned runtime/model combination actually works.
7. Once installed, processing is completely offline.

If the download or validation is cancelled or fails, return the toggle to off and keep a useful error/status message.

Turning the experiment off disables its controls and unloads warm model/GPU state but retains the downloaded payload and prepared tracks. Options provides a separate, explicit **Remove downloaded model** action. Re-enabling should not redownload anything unless the built-in payload version changed or verification fails.

If the first enable happens offline and the payload has never been installed, show **Internet required for the one-time model download**. This is acceptable progressive enhancement: core playback remains offline and prepared separation remains offline after installation.

### Vite and Workbox wrinkle

The current Workbox configuration precaches `**/*.js`, including lazy Rollup chunks. The stem-separation chunk therefore needs an explicit precache exclusion and an on-demand runtime-cache rule.

The implementation must:

- isolate the heavy implementation behind a stable dynamic-import boundary;
- emit identifiable stem-separation chunk names or a dedicated optional asset path;
- exclude those chunks from Workbox precaching;
- runtime-cache the versioned JavaScript chunk after its first import so it remains available offline;
- keep the large ONNX model out of Cache Storage and stream it into OPFS to avoid storing two copies;
- keep optional runtime Wasm out of precache and either load its verified OPFS object URL or runtime-cache exactly one versioned copy; and
- delete obsolete optional runtime caches/OPFS payload versions only after the new version is fully installed and no result still depends on them.

Keep the current 4 MB Workbox ceiling for core assets.

### Artifact integrity

- Payload URLs, byte counts, and SHA-256 digests are constants in izci's source.
- Downloads use the same origin and commit only after byte-count and digest verification.
- The worker receives bounded PCM windows; file and folder handles stay with the host.

## Persistence and cache boundaries

Use separate storage:

```text
localStorage
  izci.experimental-settings
    - experiment enabled
    - lightweight UI preferences only

IndexedDB: izci-stem-separation
  runtime
    - built-in version, exact digests, install state, byte size,
      OPFS paths, installedAt, lastVerifiedAt
  sources
    - track id -> fast source fingerprint -> result key/status
  results
    - result key, model/pipeline versions, output format, OPFS path,
      duration, sample rate, frame count, byte size, peak table,
      createdAt, lastAccessed

OPFS
  /stem-runtime/<payload-version>/<digest>
  /stem-cache/tmp/<job-id>
  /stem-cache/results/<result-key>.wav
```

Generated audio is derived, bounded, and rebuildable. It does not belong in playlist/library records or the artwork-cache database.

### Cache identity

The result key must cover:

- a digest of source audio bytes;
- source size and last-modified time as a fast invalidation hint;
- selected module is irrelevant because v1 excludes modules;
- processing-pipeline id/version;
- exact model digest;
- STFT/iSTFT and overlap-add algorithm version;
- decode sample rate/channel policy;
- encoder id/version and channel layout; and
- result schema version.

Use content identity rather than only playlist id or path. Managed folders intentionally preserve ids across rescans, and a file can change in place.

Hash the source as part of the already-required read rather than performing an extra full read where possible. A fast `(track id, size, lastModified)` source record may avoid hashing on obvious cache hits, but the committed result remains content-addressed.

### Quota and eviction

- Call `navigator.storage.estimate()` before model install and track processing.
- Ask for persistent storage only in response to the user's explicit first-enable download action; explain that denial is survivable.
- Keep the installed model/runtime payload separate from the derived-result LRU; remove it only through the explicit storage action.
- Give generated results a configurable soft cap; start conservatively (proposed default: 2 GiB) and also respect available quota.
- Evict least-recently-used completed results only. Source files and user-selected handles are outside cache ownership.
- Commit metadata only after the output file is finalized. On startup, sweep old temp files and orphaned result files.
- Surface actual model bytes, cache bytes, and reclaim actions in Options -> Experimental.

## State and ownership

Anticipated ownership, subject to refinement during implementation:

```text
src/lib/stores/experimental-settings.ts
  feature gates and lightweight synchronized settings

src/lib/services/stem-separation/
  payload download/verification/removal, eligibility, jobs, worker protocol,
  BS PolarFormer runtime, STFT/iSTFT, cache metadata, cache eviction,
  output verification

src/lib/services/stem-playback.ts
  synchronized vocal element and two-signal mixer graph

src/lib/services/audio-bus.ts
  reusable media-source adoption and active routed-source connection

src/lib/services/howler-player.ts
  optional prepared playback asset while retaining transport ownership

src/lib/services/player-controller.ts
  current-track stem status/mix orchestration, not inference details

src/options/components/views/ExperimentalView.svelte
  experiment gate, payload download/status/remove, storage usage

src/lib/components/PlayerControls.svelte
  compact current-track stem entry point and slider events
```

The worker protocol and cache types should live beside the stem-separation service rather than swelling `src/lib/types.ts` with implementation-only records. Only cross-feature domain state belongs in the shared types file.

The main window owns jobs because it owns track materialization and playback. Options may observe payload/cache summaries through focused services and `BroadcastChannel`, but it must not own audio nodes or library mutation.

## Delivery phases and gates

### Phase 0 — throwaway feasibility spikes

No product UI.

1. Prove the four-channel Howler/FLAC/Web Audio route described above.
2. Pin an ONNX Runtime Web release and prove its WebGPU bundle works in a dedicated worker in the built PWA.
3. Run a known-answer BS PolarFormer segment and compare STFT, mask, iSTFT, and final vocals against the published reference.
4. Process representative 3-, 10-, and 30-minute files; record wall time, peak memory, GPU memory symptoms, cancellation latency, and UI frame stalls.
5. Verify audio playback does not underrun while inference is paced and the visualizer is active.
6. Verify model/runtime licensing and notices.
7. Verify OPFS object-URL playback and model loading after a network-off restart.

Go forward only if:

- the prepared file exposes stable discrete channels and seeks correctly;
- center playback null-tests against its stored original pair within lossless/sample-alignment expectations;
- the provider is genuinely WebGPU on the supported test machine;
- cancellation recovers without a reload;
- an interrupted write never becomes a cache hit; and
- playback remains reliable during a paced job.

The spike may be deleted afterward. Its measurements and decisions should be folded into this document.

### Phase 1 — experiment and optional-payload foundation

1. Add the first `experimental-settings.ts`, defaulting off and synchronizing like other settings stores.
2. Add Options -> Experimental only because this is the first active experiment.
3. Add compiled-in payload metadata and the first-enable confirmation flow.
4. Implement same-origin streaming download, digest verification, OPFS commit, status, and explicit removal.
5. Add the dynamic-import boundary plus Workbox precache exclusion/runtime-cache rules.
6. Show WebGPU, payload, and storage diagnostics; no separation yet.

Gate: the optional payload is not requested before first enable, survives an offline restart after download, fails closed when corrupt, and can be removed without touching user media or derived results.

### Phase 2 — one-track preprocessing and cache

1. Implement eligibility and explicit materialization.
2. Implement single-job state, progress, cancellation, and device-loss handling.
3. Port and test the exact STFT/iSTFT/overlap-add reference behavior.
4. Integrate the pinned built-in model runtime and lossless four-channel encoder.
5. Add atomic-ish OPFS commit via temp file plus last-written IndexedDB record.
6. Add result verification, source fingerprinting, LRU touch, quota preflight, and pruning.

Gate: a prepared result can be found by the same track after restart, is invalidated after source/model/pipeline changes, and partial work is recoverable.

### Phase 3 — prepared playback source

1. Refactor audio-bus media-source adoption without changing normal stream/module behavior.
2. Add the discrete stem mixer and exact slider gain curve.
3. Let Howler load the prepared asset while retaining transport ownership.
4. Add route verification and original-source fallback.
5. Keep ReplayGain after the stem mixer and player master volume after Raf.

Gate: play/pause/seek/end/media-session behavior matches an original stream; modules remain untouched; Raf and visualizer receive the mixed stereo output.

### Phase 4 — minimum product UI

1. Add the player-bar stem popover and three-anchor slider.
2. Add prepare/progress/cancel/reprocess/delete states.
3. Add eligibility and failure explanations, including modules and unsupported WebGPU.
4. Add English and Turkish strings in the normal i18n workflow.
5. Add cache/model storage reporting and cleanup to Experimental options.

Gate: every state is understandable without opening DevTools and no action triggers an implicit folder-permission request outside a user gesture.

### Phase 5 — hardening before considering it non-bullshit

1. Test long files, mono inputs, unusual sample rates, corrupt files, rapid track changes, repeat-one, restored playback, and cache eviction during idle state.
2. Test current Chromium stable and the installed PWA, not just the in-app browser.
3. Exercise GPU loss, out-of-memory, quota denial, app update, model update, and a cancelled payload download/update.
4. Add provenance/license presentation and third-party notices.
5. Measure output quality and performance on a small fixed regression corpus that may legally live outside the repository or be synthesized in tests.

Batch processing, additional models, and module rendering can be scoped separately after these gates.

## Test plan

### Pure/unit tests

- Payload state normalization, byte-count/digest failure, version changes, interrupted downloads, and stale temporary files.
- WebGPU/shader-f16 checks and requirement reporting.
- Slider gain law at endpoints/center/intermediate points and smoothed finite parameter updates.
- Peak lookup generation/interpolation.
- Source/result keys and invalidation across every versioned input.
- LRU eviction without crossing the model/result boundary.
- Job reducer transitions, stale worker messages, cancellation, and superseded track loads.
- Worker windowing and overlap-add against small deterministic fixtures.

### Service/integration tests

- The dedicated stem-separation database keeps runtime/cache metadata out of playlist, library, and artwork storage.
- Temp-file cleanup, commit ordering, orphan sweep, and quota failures.
- Player-controller selection of original versus prepared assets.
- Howler route failure restores original playback and never emits raw four-channel audio.
- Raf on/off and ReplayGain modes receive the mixed stereo source in the correct graph position.
- Module player creation, transport, patterns, and settings remain unchanged.

### Real-browser/manual matrix

- Dev tab, standalone installed PWA, network disabled after payload installation, and app update with an existing payload/cache.
- Stream formats: MP3, WAV, FLAC, Ogg Vorbis, Opus; mono and stereo; 44.1/48/96 kHz sources.
- Play, pause, seek, scrub, repeat, track navigation, media keys, restored position, mute, volume, Raf, and visualizer.
- Integrated and discrete GPUs where available, battery/power mode changes, device loss, and memory pressure.
- Audible checks at all three anchors plus a center null/alignment test captured from the graph.

Per project rules, every eventual source-change phase ends with `npm run build`; focused tests and `npm run check` run when relevant. This planning-only change does not require a build.

## Current working decisions

These are the defaults assumed by the delivery phases above.

1. Output container: **stereo float32 WAV vocal asset**, synchronized with the original Howler element.
2. Execution fallback: **WebGPU-only in v1; no silent WASM fallback**.
3. First model: **BS PolarFormer FP16**, conditional on provenance and reference-output verification.
4. Eligibility: **stream tracks only**.
5. Trigger: **explicit one-track preparation**, not automatic processing.
6. Slider persistence: **session-global, resettable to center**, never per playlist/library record.
7. Result cache cap: **2 GiB soft default plus quota awareness**, user-adjustable later if real asset sizes demand it.
8. Delivery: **built-in versioned same-origin payload downloaded on first enable**, with compiled-in byte counts and digests.
9. Optional-code caching: **exclude the heavy dynamic chunk from precache and runtime-cache it after first import; store the model once in OPFS**.
10. UI home: **small player-bar popover**, with Experimental options reserved for installation/storage management.
11. Processing while playing: **allowed but paced**, contingent on no underruns in Phase 0; otherwise queue until paused.

## Known ways this can still be bullshit

- The 103 MB model is only the persistent headline; decoded PCM, STFT tensors, activations, encoder state, and GPU copies determine whether ordinary tracks fit comfortably.
- A worker keeps JavaScript off the UI thread but cannot stop long GPU submissions from starving the compositor.
- “WebGPU requested” does not prove all important operators ran there.
- Dual media elements can drift or resume at different times under browser scheduling pressure.
- Browser lossless encoders vary wildly in maturity and licensing.
- Model-card licensing may not fully describe the original checkpoint or training-data obligations.
- Vocal subtraction can expose phasey artifacts, reverb tails, and backing vocals; the word “more” is deliberately more honest than “remove.”
- OPFS is origin-private, not user-visible backup. Clearing site data deletes the downloaded payload and prepared results.

## Research references

- [BS PolarFormer ONNX model card and browser example](https://huggingface.co/bgkb/bs_polarformer)
- [ONNX Runtime WebGPU execution-provider documentation](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- [ONNX Runtime Web browser/provider support](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
