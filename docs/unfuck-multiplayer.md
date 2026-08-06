# Unfuck multiplayer

Notes from reviewing the rushed Freeplay MVP (commit `a32ec11`). Targets the Freeplay path hardest, with a couple of shared-multiplayer landmines. Goals: make the host a real library streaming server, kill redundant timeline work, and close the races that can leak renderers or silently no-op.

## 1. Source-file Freeplay: the host must be timeline-passive (DONE — commit `a142d51`)

**Fixed in `a142d51` ("Multiplayer: attempt timeline-passive Freeplay fix"):**
- Host `MultiplayerFreeplayPlayer` lost its wall-clock synthetic timeline (`#syntheticStartedAt`/`#syntheticStartPosition`, 250 ms progress timer, `#handleEnded` auto-advance). With no renderer (`sourceFile` delivery or host-disabled audio) it is passive: `play`/`pause`/`seek`/`stop` no-op, state stays `idle`, no live progress publishes.
- Host keeps the materialized selection per client in `core.freeplaySelections` and re-serves the file through the key-guarded `syncPeerSourceFile` on media-channel open / update (resume/reconnect path).
- Client owns the timeline via `MultiplayerSourcePlaybackService.setLocalTimeline`, gated on `mode === 'client' && freeplay && latestAudioAvailability.sourceFile`: transferred files start locally with `autoPlay`, `syncPlayback`/`#applyLatestPlayback` skip drift correction and play/pause mirroring entirely, and the client auto-advances on its own `ended` (sending `playback.ended`, or a local `replay()` for repeat-one). App transport handlers route play/pause/stop/seek to the local player controller in source-file Freeplay; next/prev/repeat stay on the `command` messages.
- Backgrounded-tab stall root cause removed: a hidden client no longer drifts against a host clock it now ignores.
- Protocol bumped to 13 (rules updated) to make the host `playback` messages a static selection rather than a live clock.

Remaining open points below are unaffected; streamed Freeplay stays host-authoritative (client is a passive WebRTC sink).

## 2. Freeplay agreement is persisted only at pair time (DONE)

**Fixed:** the agreement is now rewritten whenever either side's preference changes, not just on the pairing toggle.

- `syncPeerFreeplayMode` computes the combined agreement (`resolveMultiplayerFreeplayAgreement`: `paired && hostEnabled && clientEnabled`) and, when it diverges from the stored `peer.freeplayPaired`, persists it back to the pairing record before recomputing the active state. This runs on the client `hello` (reconnect), on `freeplay.preference`, and on the host's own settings change — so enabling Freeplay on both devices after pairing now activates immediately, and the stale-flag reconnect trap is gone.
- `persistPairingAgreement` does a get+set preserving `name`/`platform`/`pairedAt`: the DB rules require the full record, so a bare `freeplay` child write would be rejected. `togglePairing` reuses the same helper for the pair-time write.
- The client's own remembered pairing already follows along: the host sends the updated `freeplayPaired` via `pairing`, which the client persists through `rememberMultiplayerPairing`.

## 3. Async load race leaks a stale media renderer (DONE)

**Fixed:** `#loadMediaRenderer` now assigns every instance field (`#element`, `#elementSource`, `#destination`, `#objectUrl`, and the `#raf` created by `#connectRenderer`) only inside the token-gated `loadedmetadata` handler, mirroring the module path. A superseded load's continuation can no longer republish a renderer after the newer load disposed it — no orphaned element, no leaked object URL, no wrong peer audio sender. The `ended` listener is also attached only once the renderer is actually live.

## 4. Redundant host auto-advance paths (DONE — resolved by #1)

The host synthetic `ended` and client `playback.ended` no longer can both fire: with #1 the host has no renderer in source-file mode, so only the client's `playback.ended` advances the pair (host-side `playback.ended` handler keeps the `track.id ===` guard as stale-message safety). Streamed Freeplay stays a single host-driven path. Repeat-one in source-file mode is a purely local client `replay()` with no host round-trip. Nothing left to unwind.

## 5. Shuffle never picks the first track on a fresh start (DONE — fixed in `a142d51`)

`resolveFreeplayStep` already uses the full-range offset (`floor(random() * items.length)`) for the no-current-track case, so `items[0]` is reachable on a fresh shuffle start; the exclude-current offset only applies when a current track exists. Covered by the `picks from the full range on a fresh shuffle start` test.

## 6. Freeplay browse state not reset on exit (DONE)

The `changed && !active` branch of `syncPeerFreeplayMode` now resets `freeplayCollection` (to `'library'`), `freeplayShuffle` (to `false`), and `freeplayRepeatMode` (to `'off'`) alongside the existing artwork/preparation teardown, so re-entering Freeplay starts clean instead of resuming stale browse context.

## 7. Streamed Freeplay stutters / "Audio connecting" ↔ "Listening" flap (DONE)

**Fixed:** the host re-broadcast `audio` availability on every 250 ms Freeplay progress publish, and the client treated each message as a signal to tear down and rebuild its WebRTC audio element (clear + new element + `connecting` → `playing`). At 4x/sec that read as rapid stutter with the status flapping between "Audio connecting" and "Listening". Sent-file Freeplay never churned (the `sourceFile` branch skips `attachClientRemoteAudio`), and standard multiplayer never spammed (its `syncHostAudio` is change-guarded) — matching the reported symptom profile exactly.

- `syncFreeplayPlayerUpdate` now sends `{ kind: 'audio' }` only when the availability reference changed (`peer.freeplayAudioSent`). `MultiplayerFreeplayPlayer.#audio` is stable per loaded track, so this is once per load/`reconfigure`, not per progress tick. `sendCurrentState` records what it sent so a connect doesn't double-send.
- `MultiplayerAudioService.attachRemoteTrack` is now idempotent for the same live track: it keeps the element/source and just refreshes the status handler + resumes instead of clearing and rebuilding. Defense-in-depth against any redundant `audio` message.

## 8. Freeplay playlist was dead-empty — clients now own a queue (DONE)

**Fixed:** the client's Playlist panel rendered `remoteCatalog.playlist`, which the host hardcoded to `[]` for Freeplay peers while rejecting `collection === 'playlist'` — so the panel was a permanent "0 songs" shell and the client could never curate anything. Freeplay is now a sovereign queue: the client owns an ordered list of host-catalog item IDs and the host steps within it.

- New client message `{ kind: 'freeplay.queue', itemIds }` (full replacement, validated + capped at 5000 by `sanitizeFreeplayQueueIds`). The host stores it per-peer (`peer.freeplayQueue`), resolves it into the Freeplay catalog's `playlist` field (`resolveFreeplayQueueItems`), accepts `collection === 'playlist'` in `activateFreeplayTrack`, and next/prev/shuffle/repeat step within the queue once `freeplayCollection === 'playlist'`.
- Client re-sends the queue on pairing/freeplay activation (reconnect creates a fresh host peer); queue resets with Freeplay exit and `leave()`.
- UI (App.svelte): in Freeplay, double-clicking a library row adds it to the queue and plays from the queue; the Playlist panel shows the queue; context-menu Remove and the Delete key both remove from the queue. The client panel is no longer `readOnly` in Freeplay. The menu action stays the local-mode "Remove" label with the Delete shortcut (the panel localizes the `remove` id anyway).
- Protocol bumped to 14 (database.rules.json synced by the prebuild script).

## 9. Freeplay repeat/shuffle toggles lagged; the host re-shipped the whole catalog (DONE)

**Fixed:** a toggle used to round-trip a full catalog echo (entire host library +
favorites + queue) to the client, which is why the transport-bar buttons felt
sluggish. The client now flips its buttons optimistically at send time, the host
sends only a lightweight `state` message (`{ kind: 'state', shuffleEnabled,
repeatMode }`), and the catalog no longer clobbers the flags.

- New HostMessage `state` (protocol v15): the authoritative per-peer Freeplay
  shuffle/repeat source. Sent on toggle and in `sendCurrentState` (reconnect /
  activation restore). `isHostMessage` validates it; `MultiplayerCatalog` keeps
  the fields for plain multiplayer peers, but Freeplay clients treat `state` as
  the source of truth.
- Client `catalog` handler preserves the current `shuffleEnabled`/`repeatMode`
  across catalog replaces, so an in-flight echo (e.g. the queue-change reply
  generated before the host applied a toggle) can't clobber an optimistic flip.
  This matters for `replaceFreeplayQueueAndPlay`: its ordered send is
  queue → toggle → activate, and the queue echo carries the pre-toggle snapshot.
- `cycleMultiplayerRepeatMode` moved to `multiplayer-utils.ts` so the host
  toggle and the client's optimistic flip share one cycle definition.

## 10. Freeplay shuffle was stateless: no pseudorandom cycle, Prev walked list order (DONE)

**Fixed:** `resolveFreeplayStep` picked a uniform random track (excluding only the
current one) and Prev went to the previous item in collection order — nothing was
remembered. Freeplay now reuses the local `createPlaylistNavigation` per peer, so
shuffle is the same session the local playlist uses: a played-history stack + an
upcoming cycle.

- `createFreeplayStepResolver(getItems)` in `multiplayer-freeplay.ts` wraps the
  local navigation factory; the host owns one instance per Freeplay peer
  (`PeerConnection.freeplayNavigation`), seeded with `freeplayCollectionItems(peer,
  peer.freeplayCollection)`.
- Prev walks the played history (returns to what actually played, not the list
  neighbor); Next never re-picks a track until the collection is exhausted, then
  wraps to a fresh cycle only under repeat-all. Linear stepping now only wraps
  with repeat-all too (local parity: repeat-off at the end is a no-op).
- Session lifecycle mirrors the local store: reset on shuffle toggle, queue
  replacement (`freeplay.queue`), collection switch (`activateFreeplayTrack`),
  and Freeplay exit. Repeat-one stays a local host seek+play (streamed) or a
  purely client-side `replay()` (source-file).
- `multiplayer-freeplay.test.ts` rewritten to pin the new semantics (history
  Prev, no-repeat-until-exhausted, repeat-all wrap, reset, end-of-collection
  stop).

## 11. Host babysat Freeplay clients outside opus streaming (DONE)

**Fixed:** `activateFreeplayTrack` started a `playback.prepare`/`playback.ready`
handshake whenever `multiplayerWaitForClients` was on — including source-file
and host-disabled-audio selections, where the host player is timeline-passive and
the client already starts the transferred file on its own timeline. The host was
waiting for the client to confirm readiness it never needed. The handshake now
only runs when the host actually streams (WebRTC opus): the host waits for the
stream to be attached before `play()`, and otherwise does nothing but serve the
selection — library streaming without client babysitting.

## 12. Direct streamed→streamed switches replay the old track's tail (DONE)

**Fixed:** with the A→B→C path clean, switching straight between streamed tracks
(A→C→A) glitched: the previous track (C) "freaked out" — cut out/stutter for
~the jitter-buffer duration — before the new track (A) started. Root cause:
streamed→streamed transitions never waited out the retained tail. The host
disposes the old renderer at load start (wire → anchor silence) but defers the
new `audio` availability until the renderer connects; the client then attached a
FRESH element for the new track — which started by playing the old track's
retained tail (~`multiplayerAudioBufferMs`) out of the jitter buffer.

Key correction: a `jitterBufferTarget = 0` flush does NOT discard retained
audio in this Chromium — NetEq keeps it queued at the front of the playout.
The A→B→C path was clean only because the source-file interlude is SECONDS long:
the drained element (silent sink) plays the retained tail out at real time
before the next streamed track ever attaches. A streamed→streamed build
(~100–500 ms) is shorter than the buffer, so the tail survived into the fresh
pipeline.

Second correction (the "inverted freak-out"): the retained tail is NOT
`bufferMs` long — it is `bufferMs` PLUS the media element's own pipeline
latency (~100–250 ms, measured indirectly: the first fix's residual "split
second" ≈ the element latency). A wait of exactly `bufferMs` still leaves that
element-latency slice of the old track in the playout, which the fresh element
then replays as a short C blip after the silent gap.

- The client's `playback` handler detects a load of a DIFFERENT track
  (`snapshot.state === 'loading'` + track id change) while the current
  availability is streamed-enabled, and immediately `drainRemoteTrack()` —
  zero headroom: C stops the moment the loading message lands — while keeping
  the element as the receiver's silent sink, and records when the tail began
  playing out (`streamedDrainStartedAt`).
- `attachClientRemoteAudio` (fired by the new track's `audio` message) now
  waits `max(0, multiplayerAudioBufferMs + STREAMED_RETAINED_TAIL_MARGIN_MS
  (250) − elapsedSinceDrain)` before tearing down the drained element and
  building the fresh pipeline. The drained sink consumes the retained tail
  during the wait, so the fresh element starts from the live position
  (silence + the new track) — the old track is never heard after the tap, and
  the switch is simply delayed by the buffer headroom + margin (explicitly
  acceptable). A monotonic token makes concurrent attaches from rapid track
  switches idempotent.
- Streamed→source-file transitions drain at `playback(loading)` too (same
  tick as before, ordered channel) — net behavior unchanged; the interlude's
  own drain+flush still runs at the `audio(sourceFile)` message. The hook
  skips source-file→streamed (availability not enabled; the interlude already
  played the tail out) and same-track re-loads (id guard).

## 13. Streamed track start stutters/slows for its first 1–2 s (DONE — REVISED 2026-08-06)

**Fixed:** with all the switch paths clean, every streamed track START was
glitchy AND slowdown-y for the first ~1–2 s, then fine. Root cause: the fresh
element started AUDIBLE with the receiver's jitter-buffer level below the
configured target. `jitterBufferTarget` is a SETPOINT, and NetEq's delay
manager raises the level by time-stretching the playout (deceleration) — the
audible slowdown IS the cushion build. The first attempt (restore the target
at the drain + a no-sink fill wait on first attach) did NOT fix it: a
no-sink receiver doesn't build (the delay manager needs a consuming sink),
and the drain-raise budget was too short. The build must happen inaudibly,
with a consuming sink, before the audible route exists.

Final fix (client: `multiplayer-client.ts` + `multiplayer-audio.ts`; host:
`multiplayer-host.ts`):

- **Prerolled attach (`MultiplayerAudioService.attachRemoteTrackPrerolled` +
  `connectRemoteRoute`):** the fresh element is created, MUTED and OUT of the
  audible graph, but PLAYING — it is the receiver's sink, which is what lets
  NetEq's delay management run. The caller drives three phases:
  - Phase A (build): the element consumes the wire while the receiver level
    builds toward the target; polled via receiver stats
    (`jitterBufferDelay / jitterBufferEmittedCount`, meaningful only with the
    sink attached), capped at ~`bufferMs + 500` ms (`STREAMED_PREROLL_BUILD_CAP_MS`).
    The host is still PAUSED (readiness not yet reported), so the wire is the
    anchor silence — the cushion is built from silence, NOT from the track, so
    the track's beginning is buffered, not stretched/eaten.
  - Phase B (playout): only now is readiness reported (`clientRemoteAudioReady
    = true` + ready message → the host's `play()` gate releases) and the
    silence cushion (~`bufferMs` + `STREAMED_RETAINED_TAIL_MARGIN_MS`) is
    consumed at real time while the track's beginning accumulates behind it.
  - Phase C (audible): `connectRemoteRoute()` — the element has been warm and
    the receiver is at steady state, so the first audible sample is the
    track's start with a full cushion. No slowdown, no intro skipped.
- **Tail wait kept** (`streamedDrainStartedAt`): on switches, the drained
  element must finish consuming the previous track's retained tail BEFORE the
  preroll takes over, or the tail sits at the front of the fresh cushion and
  replays when the route connects. The `playback(loading)` drain still
  disconnects the old route instantly (zero headroom) and keeps the target
  applied so the level holds.
- **Host: streamed Freeplay ALWAYS gates on the readiness handshake**
  (the `!multiplayerWaitForClients` bypass was removed for the streamed
  case). The preroll needs the host paused during the build — if it played
  immediately, the build would consume (stretched, muted) the track's
  beginning and the intro would be skipped. All client types still release
  the gate: receiveAudio-off and host-disabled clients report ready
  instantly, source-file clients once their file is loaded, streamed clients
  after Phase A.
- **`ontrack` no longer attaches at all** — every streamed attach happens via
  the `audio` message (which the host re-sends at join; `sendToPeer` buffers
  until the channel opens, so it always arrives). A pre-availability attach
  was a live zero-cushion sink playing the first seconds with the slowdown.

Costs: the session's first streamed track starts after ~1.5–2.25 s of silence
(Phase A build + Phase B playout); switches pay the tail wait (~0.5–1 s) plus
Phase B (~1 s) — the "more waiting" the user explicitly accepted, in exchange
for a stutter/slowdown-free start from the first sample. `multiplayerAudioBufferMs`
scales the cushion and Phase B.

## Shared multiplayer

- Keep `syncPeerSourceFile` key-guarded (`sourceTrackKey`) — it's correctly a no-op across 250 ms progress publishes, including in Freeplay. Don't "optimize" it into per-tick re-uploads.

## Verification

- `npx vitest run src/lib/services/multiplayer-*` — 75 passed, 7 skipped (Freeplay navigation: history-Prev, no-repeat-until-exhausted, repeat-all wrap, session reset, end-of-collection stop; protocol: `state` message validation).
- `npm run check` — 0 errors, 0 warnings.
- `npm run build` — clean (protocol 15 synced into database.rules.json by the prebuild script).
- Painpoint #13 (start stutter/slowdown): unit/check/build green; live two-instance verification pending — expected: every streamed track starts after a silence pre-roll (first track ~1.5–2.25 s, switches ~1.5–2 s) and is clean from the first audible sample; no slowdown, no skipped intro, no old-track replay; host stays paused until the client's readiness.
- Live CDP verification (2026-08-06, client on Protocol v15): A→B→C streamed-transferred-streamed verified clean; #12 (direct streamed→streamed A→C→A glitch) — attempt 1 (drain+flush at loading) did NOT fix it: `jitterBufferTarget = 0` does not discard retained audio. Attempt 2 (drain at loading + attach waits `bufferMs − elapsed`) inverted the symptom to a short residual C blip — the retained tail is `bufferMs` PLUS the element's pipeline latency (~150 ms), so the wait under-estimated. Final fix: wait adds `STREAMED_RETAINED_TAIL_MARGIN_MS = 250`. Rig re-run needed — expected: C stops instantly on tap A, ~buffer+margin ms of silence, then A from its start (no C at all).

