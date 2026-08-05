# Unfuck multiplayer

Notes from reviewing the rushed Freeplay MVP (commit `a32ec11`). Targets the Freeplay path hardest, with a couple of shared-multiplayer landmines. Goals: make the host a real library streaming server, kill redundant timeline work, and close the races that can leak renderers or silently no-op.

## 1. Source-file Freeplay: the host must be timeline-passive (biggest issue)

Today, when the file-transfer threshold covers a track (`sourceFile: true`), the host still builds a `MultiplayerFreeplayPlayer`, runs a **wall-clock synthetic timeline** (250 ms progress timer, `#syntheticStartedAt`), auto-advances on its own `#handleEnded`, and owns repeat/next/prev. Meanwhile the client renders the file locally but is **slaved** to that host clock: `syncPlayback` → `#applyLatestPlayback` seeks the client back to `expectedPosition(host)` on any >1 s drift.

This contradicts the design promise (independent timeline; host idles once the threshold is "every file"). It is also the cause of the backgrounded-tab stall: the client pauses drift correction while `document.hidden`, so a hidden client's local render falls out of lockstep with the host's synthetic clock.

**Intended shape for source-file Freeplay:**
- Host = file server + command relay. Materialize + send the file the client asks for; hold "current selection" for resume/reconnect. No clock, no auto-advance, no live progress.
- Client owns its timeline: plays locally, auto-advances on its own `ended`, drives `next/prev/seek/repeat` through existing `command` messages.
- `syncPlayback` must stop drift-correcting the client against a host clock in `sourceFile` mode.

Gate this on `audio.sourceFile`. **Streamed Freeplay stays host-authoritative** — the client is a passive WebRTC sink and has nothing else to sync to.

## 2. Freeplay agreement is persisted only at pair time

The `freeplay` flag on a Firebase pairing record is written **only inside `togglePair`** (`multiplayer-session.ts:789`). Everywhere else liveness is recomputed from `peer.freeplayPaired`, which is read once from that DB record at connect.

So enabling Freeplay on both devices *after* they already paired never rewrites the agreement → `syncPeerFreeplayMode` recomputes against a stale flag → **Freeplay silently never activates until you re-pair.** Fix: write the combined agreement back to the pairing record whenever either device's preference changes, not just on the pairing toggle. Ideally the enable-later flow should just work (the Options hint implies it).

## 3. Async load race leaks a stale media renderer

In `MultiplayerFreeplayPlayer`, the module path token-guards before mutating state, but `#loadMediaRenderer` assigns `this.#element` / `#elementSource` / `#destination` / `#objectUrl` **mid-async** (right after `await audioBusService.resume()`), *before* its token-gated `loadedmetadata` resolves. If two `load()` calls interleave (e.g. `reconfigure()` from an Options change racing a client `collection.activate`), the older continuation can clobber `this.#element` with its own fresh element/objectURL after the newer load disposed it → orphaned element keeps playing, object URL never revoked, peer audio sender can point at the wrong track. Fix: only assign instance fields after the token check (mirror the module path).

## 4. Redundant host auto-advance paths

In source-file Freeplay both the host synthetic `ended` and the client's `playback.ended` can fire for the same track. The `peer.freeplayPlayer?.track?.id === trackId` dedup guard prevents double-advance today, but that redundancy disappears once #1 lands (host stops clocking). Repeat-one in source-file mode currently depends on client drift correction to rewind locally — also retired by #1.

## 5. Shuffle never picks the first track on a fresh start

`resolveFreeplayStep` with `currentIndex = -1` computes `Math.max(-1,0) + offset` with `offset ∈ [1, len-1]`, so the first shuffled pick is never `items[0]`. Minor bias; fix the offset range for the no-current-track case.

## 6. Freeplay browse state not reset on exit

On deactivate (`syncPeerFreeplayMode`, `changed && !active`), artwork and pending preparation are cleared, but `freeplayCollection` / `freeplayShuffle` / `freeplayRepeatMode` are not. Re-entering Freeplay resumes stale context. Reset all of them on deactivate.

## Shared multiplayer

- Keep `syncPeerSourceFile` key-guarded (`sourceTrackKey`) — it's correctly a no-op across 250 ms progress publishes, including in Freeplay. Don't "optimize" it into per-tick re-uploads.

## Verification

- Run `npx vitest run src/lib/services/multiplayer-*` and `npm run check` after changes.
- The Freeplay navigation and pairing-negotiation tests (`multiplayer-freeplay.test.ts`, `multiplayer-session.test.ts`) cover `resolveFreeplayStep` and `isMultiplayerFreeplayActive` — extend them when #1/#5 change behavior.
- `npm run build` before finishing (source change requirement).
