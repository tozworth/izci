# Multiplayer buffered Opus MVP

Current implementation (2026-09-28): live RTP has also been removed for video; videos use source-file delivery. Historical video exceptions below describe the earlier implementation.

## Decision

Two delivery pathways replace live WebRTC audio ("internet radio mode"), selected per track by the **Send files under** limit:

- **Direct file transfer**: files at or under the limit are sent whole over the ordered `izci-media` channel and play on the listener with its own backend. Tracker modules are usually small, so they transfer directly and keep native module playback.
- **Buffered Opus**: larger files are pre-rendered to time-indexed WebM/Opus in memory by the host, then sent over the reliable unordered `izci-render` data channel as fast as congestion control allows. The listener starts after a small contiguous window is present and keeps buffering toward the end of the track.

This is download-ahead streaming for big files, whole-file transfer for small ones, and no paced internet radio. Video remains on the live RTP path.

```mermaid
flowchart LR
  A["Host source file"] --> B["Offline decode or module render"]
  B --> C["48 kHz stereo Opus encoder"]
  C --> D["WebM init plus time-indexed clusters"]
  D --> E["Bounded in-memory render cache"]
  E --> F["Per-peer priority scheduler"]
  F --> G["Reliable unordered WebRTC data channel"]
  G --> H["Client sparse cluster store"]
  H --> I["MediaSource audio element"]
  I --> J["Listener-owned ReplayGain, Raf, analysis, and volume"]
```

## Why this shape

- Live RTP Opus is tied to wall-clock playout. A short jitter buffer cannot turn spare bandwidth now into protection against a long outage later.
- Whole-file transfer can use spare bandwidth, but the current client cannot play until every source byte arrives.
- Time-indexed encoded clusters provide both properties: immediate progressive playback and whole-track download ahead.
- The current ordered media channel cannot truly reprioritize a seek past bytes already submitted to SCTP. A reliable unordered channel plus a deliberately small `bufferedAmount` window bounds stale in-flight work and allows the next application-selected cluster to jump the queue.
- WebM/Opus is the primary Chromium target and gives MediaSource an initialization segment followed by timestamped, independently appendable audio clusters. Prove sparse, out-of-order cluster append in Chromium before building the complete path; if that spike fails, keep the same wire/cache design and replace only client playback with WebCodecs Opus decode and scheduled `AudioBufferSourceNode`s.

## Render and cache

Add a worker-backed render coordinator owned by Multiplayer services.

- Output: 48 kHz, stereo, Opus VBR at the existing configured bitrate, in WebM clusters of about one second.
- Regular audio: reuse Mediabunny's worker-side decode/transcode path and discard video tracks.
- Tracker modules: the shared offline libopenmpt/Hively renderer feeds bounded PCM chunks directly into the Opus encoder instead of retaining whole-track PCM.
- Produce one continuous Opus timeline. Capture a WebM initialization segment and cluster-aligned byte ranges with start/end timestamps.
- The first implementation may finish the host render before announcing it. The client must still play before the transfer finishes. A later optimization may publish completed clusters while the remainder is still rendering.
- Cache key: source path, size, last-modified time, subsong, renderer settings/version, bitrate, channel layout, and sample rate.
- Deduplicate concurrent requests, including Freeplay peers requesting the same render.
- Store one shared set of `ArrayBuffer` clusters. Per-peer queues hold cluster indexes, not copied payloads.
- Pin active renders and evict unpinned entries by compressed-byte LRU under a configurable memory cap. Cancel obsolete unfinished work when it has no consumers.
- Never write renders to playlist/library records, IndexedDB, the service-worker cache, or disk.

The encoded audio is dry renderer output. On the client it enters the shared audio graph before listener-owned ReplayGain/Raf/analysis/master volume. Start, pause, seek, and replacement use short transition ramps. Exact two-track crossfade reproduction needs a host-authored transition schedule and remains a follow-up.

## Wire protocol and scheduling

Bump the experimental protocol version without compatibility adapters.

Control messages:

- `render.manifest`: generation, render ID, track ID, source revision, codec/container, duration, bitrate, cluster duration, cluster timestamps/sizes, init size, and total bytes.
- `render.need`: generation, request epoch, target time, desired seconds ahead, and compact received-cluster ranges.
- `render.ready`: the client has enough contiguous media at the intended start position.

Binary media frames identify render ID, request epoch, cluster index, fragment offset, and fragment length. Keep fragments small enough for broad RTC data-channel behavior (start with 16 KiB). Duplicate fragments are harmless; malformed or mismatched generations are dropped.

For each peer, choose unsent work in this order:

1. The newest seek target and its startup window.
2. The current authoritative playhead and its protection window.
3. Missing clusters from that point toward the end of the track.
4. Any earlier holes, then speculative work.

Do not application-pace to the Opus bitrate. Drain at available channel speed while honoring a small high-water mark for `bufferedAmount`; this is backpressure, not throttling. Pause does not stop download-ahead. A new track cancels that peer's old schedule but may leave the completed render in the LRU cache.

On seek, the client increments its request epoch, discards obsolete queued priorities, requests the cluster containing the new time plus the forward startup window, and resumes once that range is contiguous. Old in-flight clusters may still be retained for later, but cannot block the new request behind an unbounded ordered queue.

## Client playback

Create one Multiplayer-owned `MediaSource`/`SourceBuffer` pipeline and route its hidden audio element through the same listener-side Web Audio entry used by remote audio.

- Append the init segment once, then append available clusters in timestamp order within each requested window. Sparse buffered ranges are allowed.
- Start or resume only when the configured contiguous buffer exists at the desired time, or when the remainder of the track is shorter than that target.
- Continue accepting and storing clusters while playing until the render is complete.
- If playback catches the buffered edge, enter `buffering`, request the current host position at urgent priority, and resume at the host-authoritative position rather than accumulating permanent lag.
- A host seek changes priority, not the render ID. Track/bitrate/renderer changes create a new generation and MediaSource.
- On reconnect, send received ranges and request only missing clusters.
- Release all compressed clusters, object URLs, media elements, and SourceBuffers when a generation is no longer current and not cacheable client-side.

Normal hosted playback shares one render across listeners. Freeplay keeps a separate authoritative timeline and scheduler per peer, but reuses render cache entries across peers. Source bytes and buffered playback must never enter the host playlist or shared player controller for Freeplay.

## Options

Keep the Goldilocks controls under Options -> Experimental -> Multiplayer Audio:

- **Send files under**: the per-track pathway selector (restored 2026-08-10). Files at or under the limit transfer whole and play on the listener; larger files pre-render to buffered Opus. `0` = off (everything renders), `−1` = every file transfers.
- **Opus VBR bitrate**: retain it, but it now controls the actual pre-render rather than an RTP ceiling. Disabled while "Every file" is selected (nothing renders).
- **Start/rebuffer after**: replace the RTP jitter-buffer wording and expand the useful range; initial proposal is 3 seconds default, 1–30 seconds.
- **Pre-render memory limit**: compressed render-cache cap; initial proposal is 256 MiB with a small set of bounded choices.

Keep cluster duration and transport high-water marks internal until evidence shows that users benefit from exposing them.

## Implementation order

1. **Feasibility spike — DONE (2026-08-09, desktop Chromium 149).** Mediabunny produces valid clustered WebM/Opus (`minimumClusterDuration` is expressed in **seconds**, not ms — a 1000 ms value silently disables splitting). The EBML splitter (`multiplayer-webm.ts`) yields a clean init (EBML + Segment + SeekHead + Info + Tracks) plus full cluster elements; cluster slices must include the element header, not just the payload. Verified live in headless Chromium via a standalone page: init + cluster[2] alone buffers `[2,3]` and seeks to 2.0 s; init + c0..c2 plays and advances currentTime; forward and backward seeks via remove-then-reappend land correctly; ffmpeg WebM/Opus behaves identically. Android Chromium still to be tested on the phone.
2. **Renderer — DONE.** Worker-backed coordinator (`multiplayer-render-coordinator.ts`, `multiplayer-render.worker.ts`): regular audio goes through Mediabunny file → WebM/Opus with video discarded; modules stream bounded PCM chunks from the shared libopenmpt/Hively core (`module-render-core.ts`, extracted from the Editor worker) directly into the encoder. Output is split into ~1 s clusters with a cluster index; the bounded LRU cache (`multiplayer-render-cache.ts`) deduplicates by key (path/size/mtime/subsong/bitrate/renderer version), pins active entries before eviction, and evicts unpinned entries by compressed-byte LRU under the configured cap. The first implementation finishes the whole compressed render before announcing (per the doc); incremental cluster publishing is the follow-up.
3. **Transport — DONE.** Protocol v18: `render.manifest` / `render.need` / `render.ready`, explicit source revisions for safe client-cache reuse, binary fragment framing (16 KiB, render ID + request epoch + cluster index + offset; init uses a marker index), a reliable unordered `izci-render` data channel, per-peer queues with a 512 KiB `bufferedAmount` high-water mark (backpressure, not pacing), and the priority scheduler (`multiplayer-render-scheduler.ts`: seek window → playhead protection window → forward download-ahead → earlier holes). Seeks bump the client epoch; stale-epoch frames are dropped client-side.
4. **Playback — DONE.** Client pipeline (`multiplayer-render-playback.ts`): one Multiplayer-owned MediaSource/SourceBuffer, init appended once, clusters appended in ascending timestamp order per window (sparse ranges allowed; a seek clears buffered data and re-appends from the retained compressed clusters). Readiness requires the configured contiguous window or the fully buffered remainder near end of track; rebuffering at the buffered edge requests the current host position at urgent priority; drift correction seeks the element; the hidden unmuted element enters the shared graph through `connectHtmlMediaElement` (transition envelope → ReplayGain → Raf → analyser → master volume), with audibility owned by `setSourceGain`. Generations tear down MediaSource/element/clusters.
5. **Session integration — DONE.** Audio and modules route by the Send files under limit: files at or under it transfer whole (`source-file`; the listener plays with its own backend, keeping tracker modules native), larger files pre-render to buffered Opus — for both hosted (shared) and Freeplay timelines. Live RTP remains only for video. Freeplay keeps a separate authoritative timeline per peer (`MultiplayerFreeplayPlayer` render mode is a wall-clock timeline with no renderer element) while sharing render cache entries across peers. Bitrate and transfer-limit changes force a fresh delivery generation; the cache limit applies live.
6. **Controls and diagnostics — DONE.** Options → Experimental → Multiplayer Audio: bitrate now describes the pre-render, "Start/rebuffer after" replaces the RTP buffer wording (1–30 s, default 3 s), a "Pre-render memory limit" selector (64/128/256/512 MiB, default 256) was added, and "Send files under" was restored (0 / 1 / 2 / 4 / 8 / 16 / 32 / 64 MiB / Every file; the bitrate slider disables on Every file). One-shot diagnostics log render time, cache hits, cluster counts, readiness, and rebuffers.
7. **Live RTP audio removal — DONE (2026-08-10).** "Internet radio mode" is fully gone: `resolveMultiplayerDeliveryMode` never returns `stream` for audio or modules, and the render-failure fallback (`renderFallbackTrackIds`) now flips the track to `source-file` transfer instead of opening a live audio stream. The source-file transfer/playback path is the second, first-class pathway (selected by the Send files under limit), not dormant code. Only video uses the live RTP path.

## Verification (2026-08-10 — direct-transfer pathway restored)

### 0.3.1b salvage hardening

- Protocol v18 adds an explicit source revision to manifests, preventing client-cache reuse after a source file changes; Firebase rules are synchronized to v18.
- Tracker modules now feed bounded PCM chunks directly into the Opus encoder. The Editor retains its complete-channel adapter without forcing Multiplayer to materialize whole-track PCM.
- Render acquisition pins cache entries before eviction, including entries larger than the nominal cache cap, and stale acquisitions release their pins.
- Near-end readiness requires the fully buffered remainder, and render readiness is accepted only for the current generation, render ID, and seek epoch.
- `npm run check`, `npm run i18n:validate`, protocol validation, and `npm run build` pass. Full suite: 136 files, 603 passed, 7 skipped (RTDB rules).

- Full suite: `npx vitest run` — 135 files, 596 passed, 7 skipped (RTDB rules). Focused multiplayer + settings suites: 139 passed. New coverage: delivery threshold semantics (`multiplayer-session.test.ts`), Freeplay source-file passive timeline (`multiplayer-freeplay.test.ts`), transfer-limit normalization (`experimental-settings.test.ts`).
- `npm run check` — 0 errors, 0 warnings. `npm run build` — succeeds; `npm run i18n:validate` passes with the restored en/tr keys (Askew untouched).
- Live RTP audio is unreachable for audio/modules: the resolver never returns `stream` for them, and the render-failure fallback sends the source file instead of opening a live audio stream. Video keeps live RTP.
- Two-instance CDP rig (2026-08-10, fresh Helium profiles, limit 16 MiB): `rig-two-pathway-pass.py` 33/33 green — Impulse.s3m transferred whole and played natively (1.1 s), sent→render 6.6 s, render→sent 1.1 s, repeated cross-transitions clean, Broken.s3m fell back to whole-file transfer (no live RTP), 0 rebuffers / 0 transfer failures / 0 errors. `rig-buffered-opus-pass.py` (limit 0 = all render) green through seeks/pause/module render/cache replay; its P8 fallback assertion was updated to the new whole-file behavior. Phone hook still pending for real links.

## Verification (2026-08-09, evening — two-instance CDP rig + fixes)

- Focused: `npx vitest run src/lib/services/multiplayer-* src/lib/stores/experimental-settings.test.ts` — all pass, including new `multiplayer-webm`, `multiplayer-render-scheduler`, `multiplayer-render-transfer`, and `multiplayer-render-playback` tests plus updated protocol/freeplay/session/settings tests (v17 rules synced into `database.rules.json` via the prebuild script).
- Full: `npx vitest run` — 134 files, 584 passed, 7 skipped.
- `npm run check` — 0 errors, 0 warnings. `npm run build` — succeeds; the render worker is emitted as `dist/assets/multiplayer-render.worker-*.js`.
- Feasibility spike (Chromium 149 headless): sparse seek-target append, forward/backward seeks, and playback all verified; details under Implementation order item 1.
- **Two-instance CDP rig (throwaway Helium profiles, 9222 host + 9223 client, preview build):** Freeplay host+client connected at protocol v17 and played end to end. Streamed FLAC, streamed Opus, and a tracker module (S3M via libopenmpt) all played: manifest accepted → `Buffered Opus ready` (3 s window) → `client ready` → host `readiness applied ... playing:true` → client MSE element advancing at 1x with the full render buffered (e.g. `[0, 262.34]` for Supermoon). Forward and backward seeks land at the target (`[150, 262.34]`, `[40, 262.34]`) and playback resumes; track switches rebuild the pipeline per generation.

### Bugs found and fixed by the rig (2026-08-09)

1. **Init append race (nothing played at all).** The init fragment arrives back-to-back with the manifest, usually BEFORE `MediaSource.sourceopen` fires. `#appendInit` enqueued the append on the promise chain, the chain step saw `#sourceBuffer === null` and silently dropped it, `#initAppended` stayed false forever, `#scheduleAppends` early-returned on `#initAppended === false`, and the host never got `render.ready` → the playback gate never released. Fix: the init append is enqueued from `#scheduleAppends` (re-checked on every schedule, including the sourceopen handler), and `#afterAppend` re-schedules so the drain is self-propagating.
2. **Duration unit bug.** `readInfoDuration` divided by 1_000, but TimecodeScale is in nanoseconds — a 262 s track reported `durationMs: 262340000`. Fix: divide by 1_000_000 (test fixture updated to timecode units: Duration 3500 for 3.5 s at 1 ms scale).
3. **Seek froze playback.** After `#performSeek` the element kept its stale pre-seek position, so `#bufferedMs()` (measured from the element position) returned 0 and readiness never re-armed — and the drift correction that would move the element is itself ready-gated. Fix: `#performSeek` moves `element.currentTime` to the clamped target immediately.
4. **Transfer deadlock after the first 512 KiB.** The first `schedulePeerRender` plan enqueued every cluster; `queueRenderFragments` flushed until `bufferedAmount` hit the 512 KiB high-water, leaving the rest of the render (multi-MB) in `renderOutgoing`. `onbufferedamountlow` called `schedulePeerRender`, which bails when `renderQueuedBytes >= RENDER_QUEUE_HIGH_WATER` — so nothing ever drained the queue; the client starved at ~32 clusters (≈31 s) and rebuffered forever. Fix: the `bufferedamountlow` handler now calls `flushPeerRender(peer)` first, then re-plans.
5. **`muted` element played into a dead graph (phone-verified 2026-08-09, "buffer bar fills up but nothing is heard").** `#createMediaSource` created the hidden element with `muted = true`; in Chromium the `muted` attribute ALSO silences the `MediaElementAudioSourceNode` tap, so the element advanced at realtime (currentTime 111.8 → 126.3 s over 14.4 s of wall time) while the Raf meter read −60 dB/−60 dB and scrcpy audio capture was all zeros. The streamed RTP path never hit this because its audible route is a `MediaStreamAudioSourceNode` (element mute is irrelevant there); the render path is the first muted `MediaElementSource` in the codebase. Fix: drop `muted` — the tap reroutes the element's audio into the graph exclusively, and silence is owned by `setSourceGain` via `setAudible`. Bonus: the unmuted element is no longer suspended by mobile Chromium when the page is hidden.
6. **Init/manifest race (phone-verified 2026-08-09, second session).** The init rides the unordered `izci-render` channel and can beat the manifest (ordered control channel); the client's ingest dropped the orphan init, the host never re-sent it (`initSent` stayed true), and clusters piled up in `#received` forever (element readyState 0, NaN duration, hundreds of 16 KiB frames received per the channel hook, zero `appendBuffer` calls). Fixes: client buffers pre-manifest init fragments (`#pendingInitFragments`, assembled in `setManifest`); host `handlePeerRenderNeed` resets `state.initSent = false` so every need re-sends the init (the client dedups).
7. **Halfway-point spurious rebuffer (phone-verified 2026-08-09).** `#bufferedMs()` returns the window AHEAD of the element position, but the rebuffer check subtracted `localMs` again (`end − 2×position` < margin), firing at the halfway point of every track (logged at 117.2 s of a 234.68 s track) and stranding the pipeline in rebuffering. `#checkReadiness` had the same double subtraction. Both fixed.
8. **`playback.prepare` validation rejected `render` (phone-verified 2026-08-09, "transport controls do nothing").** `isHostMessage`'s prepare check allowed only `'source-file' | 'stream' | 'none'`, so the host's every buffered-Opus prepare was silently dropped by the client's decoder. Boot worked (the client self-reports ready when the pipeline arms) — only pause→play deadlocked. Fix: `'render'` added to the union + protocol regression test, plus a client-side ready-dedup reset on fresh prepares.

### Re-verified after the fixes

- Supermoon.flac: full `[0, 262.34]` buffered, no rebuffer events, playback advanced 5 → 71 s cleanly at 1x.
- Seek 90 s and 150 s forward, 40 s backward: all land and resume; retained compressed clusters make the re-append instant.
- Track switches (Supermoon → The Fountain → Impulse.s3m): each generation rebuilds and plays from 0.
- Impulse.s3m (8:58 module): libopenmpt render took ~20 s (539 clusters, 8.77 MB), full transfer, `[0, 538.88]` buffered, playback advancing.
- Android Chromium and real-network links still need the phone hook (see the izci-multiplayer-development skill). 2026-08-09 phone session (s23u, deployed 0.3.1-b): after fixing the muted-tap bug, the render element becomes audible on the phone; verify with scrcpy `--no-video --audio-source=output --audio-codec=raw --record=<file>.wav --record-format=wav` (laptop sink-monitor capture is contaminated by the host's own playback and proves nothing). Also fixed live: host-restart deadlock (idle Freeplay player never published → reconnecting client with a stale track never re-sent `collection.activate`; host now publishes the idle state once at activation when there's no restored selection). Verified end to end: `Buffered Opus ready` → element unmuted and advancing at 1x → Raf meter −35/−24 dB → scrcpy capture peak 22k, zero silent windows.

## Not in this MVP

- Video frame delivery or buffered video/audio synchronization.
- Persistent or service-worker caching of rendered media.
- Adaptive bitrate ladders or mid-track bitrate switching.
- Internet-facing HTTP/HLS hosting.
- Perfect crossfade overlap until transition scheduling is carried explicitly in the protocol.
