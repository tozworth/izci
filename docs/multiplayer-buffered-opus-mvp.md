# Multiplayer buffered Opus MVP

## Decision

Replace the choice between live WebRTC audio and whole-source-file transfer for audio and modules with a third delivery path: the host renders each track to time-indexed WebM/Opus in memory, then sends it over WebRTC data channels as fast as congestion control allows. The listener starts after a small contiguous window is present and keeps buffering toward the end of the track.

This is download-ahead streaming, not paced internet radio and not “download the whole file, then play.”

Video remains on the existing live RTP audio path for this MVP. There is no persistent encoded cache.

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
- Tracker modules: move/refactor the existing offline libopenmpt/Hively chunk renderer so PCM chunks feed the Opus encoder directly; do not materialize a whole-track `AudioBuffer`.
- Produce one continuous Opus timeline. Capture a WebM initialization segment and cluster-aligned byte ranges with start/end timestamps.
- The first implementation may finish the host render before announcing it. The client must still play before the transfer finishes. A later optimization may publish completed clusters while the remainder is still rendering.
- Cache key: source path, size, last-modified time, subsong, renderer settings/version, bitrate, channel layout, and sample rate.
- Deduplicate concurrent requests, including Freeplay peers requesting the same render.
- Store one shared set of `ArrayBuffer` clusters. Per-peer queues hold cluster indexes, not copied payloads.
- Pin active renders and evict unpinned entries by compressed-byte LRU under a configurable memory cap. Cancel obsolete unfinished work when it has no consumers.
- Never write renders to playlist/library records, IndexedDB, the service-worker cache, or disk.

The encoded audio is dry renderer output. On the client it enters the shared audio graph before listener-owned ReplayGain/Raf/analysis/master volume. Start, pause, seek, and replacement use short transition ramps. Exact two-track crossfade reproduction needs a host-authored transition schedule and is a follow-up; until then, an active overlap may retain the live RTP path rather than silently changing the mix.

## Wire protocol and scheduling

Bump the experimental protocol version without compatibility adapters.

Control messages:

- `render.manifest`: generation, render ID, track ID, codec/container, duration, bitrate, cluster duration, cluster timestamps/sizes, init size, and total bytes.
- `render.need`: generation, request epoch, target time, desired seconds ahead, and compact received-cluster ranges.
- `render.ready`: the client has enough contiguous media at the intended start position.
- `render.error`: bounded failure code; the host may fall back to live RTP for that generation.

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

- **Opus VBR bitrate**: retain it, but it now controls the actual pre-render rather than an RTP ceiling.
- **Start/rebuffer after**: replace the RTP jitter-buffer wording and expand the useful range; initial proposal is 3 seconds default, 1–30 seconds.
- **Pre-render memory limit**: compressed render-cache cap; initial proposal is 256 MiB with a small set of bounded choices.

Remove **Send files under** once buffered Opus covers audio and modules. Keep cluster duration and transport high-water marks internal until evidence shows that users benefit from exposing them.

## Implementation order

1. **Feasibility spike — DONE (2026-08-09, desktop Chromium 149).** Mediabunny produces valid clustered WebM/Opus (`minimumClusterDuration` is expressed in **seconds**, not ms — a 1000 ms value silently disables splitting). The EBML splitter (`multiplayer-webm.ts`) yields a clean init (EBML + Segment + SeekHead + Info + Tracks) plus full cluster elements; cluster slices must include the element header, not just the payload. Verified live in headless Chromium via a standalone page: init + cluster[2] alone buffers `[2,3]` and seeks to 2.0 s; init + c0..c2 plays and advances currentTime; forward and backward seeks via remove-then-reappend land correctly; ffmpeg WebM/Opus behaves identically. Android Chromium still to be tested on the phone.
2. **Renderer — DONE.** Worker-backed coordinator (`multiplayer-render-coordinator.ts`, `multiplayer-render.worker.ts`): regular audio goes through Mediabunny file → WebM/Opus with video discarded; modules render via the shared libopenmpt/Hively core (`module-render-core.ts`, extracted from the Editor worker) and feed the Opus encoder without a whole-track AudioBuffer. Output is split into ~1 s clusters with a cluster index; the bounded LRU cache (`multiplayer-render-cache.ts`) deduplicates by key (path/size/mtime/subsong/bitrate/renderer version), pins active entries, and evicts unpinned by compressed-byte LRU under the configured cap. The first implementation finishes the whole render before announcing (per the doc); incremental cluster publishing is the follow-up.
3. **Transport — DONE.** Protocol v17: `render.manifest` / `render.error` / `render.need` / `render.ready`, binary fragment framing (16 KiB, render ID + request epoch + cluster index + offset; init uses a marker index), a reliable unordered `izci-render` data channel, per-peer queues with a 512 KiB `bufferedAmount` high-water mark (backpressure, not pacing), and the priority scheduler (`multiplayer-render-scheduler.ts`: seek window → playhead protection window → forward download-ahead → earlier holes). Seeks bump the client epoch; stale-epoch frames are dropped client-side.
4. **Playback — DONE.** Client pipeline (`multiplayer-render-playback.ts`): one Multiplayer-owned MediaSource/SourceBuffer, init appended once, clusters appended in ascending timestamp order per window (sparse ranges allowed; a seek clears buffered data and re-appends from the retained compressed clusters). Readiness when the contiguous window reaches the host `buffer` setting (or the remainder is shorter); rebuffering at the buffered edge requests the current host position at urgent priority; drift correction seeks the element; the hidden muted element enters the shared graph through `connectHtmlMediaElement` (transition envelope → ReplayGain → Raf → analyser → master volume), with audibility ramped via `setSourceGain`. Generations tear down MediaSource/element/clusters.
5. **Session integration — DONE.** Audio and modules default to buffered Opus for both hosted (shared) and Freeplay timelines; live RTP remains only for video and for per-track render-failure fallback (`renderFallbackTrackIds`). Freeplay keeps a separate authoritative timeline per peer (`MultiplayerFreeplayPlayer` render mode is a wall-clock timeline with no renderer element) while sharing render cache entries across peers. Bitrate changes force a fresh delivery generation; the cache limit applies live.
6. **Controls and diagnostics — DONE.** Options → Experimental → Multiplayer Audio: bitrate now describes the pre-render, "Start/rebuffer after" replaces the RTP buffer wording (1–30 s, default 3 s), and a "Pre-render memory limit" selector (64/128/256/512 MiB, default 256) was added; "Send files under" was removed from en.json/tr.json (Askew untouched, `i18n:validate` passes). One-shot diagnostics log render time, cache hits, cluster counts, readiness, and rebuffers.
7. **Removal — NOT DONE (deferred per the doc: "after parity tests").** The source-file transfer/playback code is dormant (nothing selects `source-file` anymore) but still present; the old RTP jitter-buffer controls were already replaced by the render controls. Delete the dormant paths after live parity testing.

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
