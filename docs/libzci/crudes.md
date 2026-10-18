# Consumer behavior

[Overview](README.md) · [Roadmap](phases.md) · [Design](scaffolding.md)

The applications exercise the real public API. Native uses eframe/egui; PWA
uses plain HTML/TypeScript. Keep controls dense/plain and domain logic in core.

## CLI

At R3, retain this interface with explicit units in help:

```text
zci-play <path>
  --device <selector> --volume <linear-0..1> --start <seconds>
  --subsong <index> --diagnostics --render-pcm <output>
```

Flags become Load options and session/render commands. No family sniffer,
concrete decoder construction, sample-rate assumption, or navigation policy in
the consumer. Provider registration is assembly; selection is core. Wait for
terminal session/job outcomes, not decoder EOF. Ctrl-C cancels open, seek,
render, and playback and tears down resources.

Render writes bounded chunks as they arrive. Document stereo float32-LE/rate
for the output; diagnostics stay on stderr. Exit 0 means completed, 130 means
interrupted, and typed failures are nonzero. Device-free render opens no device.
Default invocation needs no database. M2 adds explicit `--profile`.

## The two crude UIs

Grow the existing PWA and M1 native crude with these real operations. Every
displayed fact comes from queries/snapshots/events; local focus/selection and
viewport state stay local. Disable unsupported controls with a capability reason.

| Milestone | Controls and observations |
| --- | --- |
| R4 browser, M1 native | Open; Play/Pause/Stop; seek seconds; volume/mute; source/provider; requested/output state; audible vs decoded position; error/cancel/dispose |
| M1 | Supported module subsong/interpolation/ramping/speed/pitch/channel controls; metadata/pattern inspection; separate probe/render job; codec capabilities |
| M2 | Queue duplicates/remove/move/play/next/previous/up-next/shuffle/repeat; profile; restore/grants; attached client; install/offline/update |
| M3 | Paged Library/Favorites sort/filter/group; roots/rescan/cancel; ratings/bookmarks/count threshold; details/lyrics/current line/pattern table; artwork; independent image navigation |
| M4 | Rack CRUD/order/bypass/dry-wet/parameters; preset CRUD; loadout targets/priority/override/effective reasons; preparation/transition settings |
| M5 | One video viewport, streams/seek/visibility/surface handoff; A/V offset, frame/queue/drop/resource diagnostics |

Editing/closing a window never owns playback progression, counts, matching, or DSP.

## Browser lifecycle

R4 proves actual reference Opus, worker File reads, shared Rust worklet output,
bounded credit/recycle transport, and early background feasibility. A silent
PCM statistics page does not satisfy it. WebCodecs audio is optional later.

M2 adds independent manifest, service worker, caches, and storage on port 5197.
All runtime assets are local/offline. Update loaders/WASM/workers coherently.
Preserve grants through reload/update; plain File selections are non-restorable.

Media Session actions become commands, metadata/position come from core. An
adapter transport anchor may help OS controls; it never supplies media time.
Show unlock/suspended/interrupted/failed states truthfully. Record tab/installed,
desktop/physical Android, OS actions/audio continuity separately. A service
worker is neither player nor database owner.

Second windows attach to the owner and receive snapshots/events/outcomes. They
never create another decoder/output/SQL instance for that session/profile.
Owner loss is visible; re-election may interrupt audio and restores paused.

## Diagnostics

Expose session/generation/provider, command/job outcomes, requested vs running,
audible vs decoded position, queued/pending frames/high-water marks, consumed
media vs underrun silence, latency facts, grants/storage, and bounded errors.
Add prepared-source and frame-resource counts with those features. These remain
transient. Long playback, starving output, rapid seeks, and teardown should make
dropped media, stale generations, false EOF, or retained resources observable.
