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

## Shared multiplayer

- Keep `syncPeerSourceFile` key-guarded (`sourceTrackKey`) — it's correctly a no-op across 250 ms progress publishes, including in Freeplay. Don't "optimize" it into per-tick re-uploads.

## Verification

- `npx vitest run src/lib/services/multiplayer-*` — 60 passed, 7 skipped (incl. new `MultiplayerAudioService` idempotent re-attach coverage).
- `npm run check` — 0 errors, 0 warnings.
- `npm run build` — clean.

