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
| M4 (post-MVP) | Full rack/preset/loadout/preparation controls; not an adoption gate |
| M5 (post-MVP) | Core video viewport and stream/surface diagnostics; existing browser video path stays functional meanwhile |

Editing/closing a window never owns playback progression, counts, matching, or DSP.

Visual jobs use a separate rebuildable rendition cache: native stores PNGs in
`artwork-cache-v1.sqlite3` beside the profile; browser stores PNG Blobs and bounded
metadata in `libzci-artwork-cache-v1-<profile>` IndexedDB. Neither is domain SQL or
the capability registry. Defaults are 64 MiB / 256 entries; the public cache
budget permits disabling storage and caps it at 256 MiB / 4096 entries. Shared
Rust owns revision/spec/pipeline keys, LRU admission/eviction and PNG validation.
Source access and live revision checks precede a hit. Corrupt/unavailable caches
fall back to fresh visual work; grant/source failures remain visible. Source
pixels, raw ICC/artwork and surface RGBA never enter persistence. Native preview
shows cache counters; browser rendition outcomes report hit/miss/unavailable.

## Browser lifecycle

R4 proves actual reference Opus, worker File reads, shared Rust worklet output,
bounded credit/recycle transport, and early background feasibility. A silent
PCM statistics page does not satisfy it. WebCodecs audio is optional later.

M2 adds independent manifest, service worker, caches, and storage on port 5197.
All runtime assets are local/offline. Update loaders/WASM/workers coherently.
Preserve grants through reload/update; plain File selections are non-restorable.

Media Session actions become commands, metadata/position come from core. An
adapter transport anchor may help OS controls; it never supplies media time.
Show unlock/suspended/interrupted/failed states truthfully. MVP requires
tab/installed desktop Chromium evidence; physical Android, OS actions and
background audio continuity are post-MVP evidence. A service worker is neither
player nor database owner.

Second windows attach to the owner and receive snapshots/events/outcomes. They
never create another decoder/output/SQL instance for that session/profile.
Owner loss is visible; re-election may interrupt audio and restores paused.

## Diagnostics

Expose session/generation/provider, command/job outcomes, requested vs running,
audible vs decoded position, queued/pending frames/high-water marks, consumed
media vs underrun silence, latency facts, grants/storage, and bounded errors.
Prepared-source and frame-resource counts are post-MVP with their owning
features. Diagnostics remain transient. Long playback, starving output, rapid
seeks and teardown should make dropped media, stale generations, false EOF or
retained resources observable.
