# Source and input reference

[Overview](README.md) · [Review](review.md) · [Roadmap](phases.md)

Recovery baseline: `168874dd` on `libzci-muse`. Original discovery: 2026-10-05;
review/revision: 2026-10-18. Source links are implementation inputs, not claims
that the new engine reproduces all behavior.

## Attempted implementation

| Source | Recover or inspect |
| --- | --- |
| [Session](../../libzci/crates/libzci/src/session.rs), [commands](../../libzci/crates/libzci/src/command.rs), [events](../../libzci/crates/libzci/src/event.rs) | R2 replaces synchronous ownership with command/job/output flow |
| [Ring](../../libzci/crates/libzci/src/audio/buffer.rs), [native pipeline](../../libzci/crates/libzci-native/src/playback.rs) | R1 safety, credits, suffix/tail retention, generation acknowledgment |
| [Native output](../../libzci/crates/libzci-native/src/audio.rs), [runtime](../../libzci/crates/libzci-native/src/runtime.rs), [clock](../../libzci/crates/libzci/src/audio/clock.rs) | Lock lifetime, truthful state, clock and format negotiation |
| [Sources](../../libzci/crates/libzci-native/src/source.rs), [providers](../../libzci/crates/libzci/src/provider.rs) | Bounded reads/instances; Pending vs EOF and public options |
| [Opus](../../libzci/crates/libzci-codecs/src/opus.rs), [Ogg](../../libzci/crates/libzci/src/ogg_reader.rs) | Existing raw-libopus policy/tests to compare with libopusfile |
| [OpenMPT](../../libzci/crates/libzci-codecs/src/openmpt.rs), [Hively](../../libzci/crates/libzci-codecs/src/hively.rs), [C context](../../libzci/crates/libzci-codecs/c/hively_context.c) | Native wrappers, stepped jobs, instance isolation |
| [Browser engine](../../libzci/crates/libzci-web/src/engine.rs), [worker](../../libzci/consumers/crude-pwa/src/workers/decode-worker.ts) | Platform-codec path, duplicate seek policy, scan responsiveness, async EOF |
| [CLI](../../libzci/consumers/zci-play/src/main.rs) | Move subsong policy/render buffering to public operations |
| [Pins](../../libzci/vendor/dependencies.json), [scripts](../../libzci/scripts/), [long Opus](../../libzci/tests/synth-opus-30s.sh) | Provenance; GNU/Linux recipes, missing browser/Windows work |
| [Old log](implementation-log.md) | Historical claims/pending checks, not readiness |

## Existing behavior and acquisition inputs

| Area | Source |
| --- | --- |
| Transport/preparation | [Controller](../../src/lib/services/player-controller.ts), [commands](../../src/lib/services/playback-commands.ts), characterization tests |
| Modules | [OpenMPT](../../src/lib/services/openmpt/), [module player](../../src/lib/services/module-player.ts), [Hively C wrapper](../../scripts/vendor/ahx/ahx-wrapper.c), [Hively tests](../../src/lib/services/ahx-worklet.test.ts) |
| Queue/facts | [Types](../../src/lib/types.ts), [queue](../../src/lib/stores/queue.ts), navigation/dedupe/reconciliation tests, [ratings](../../src/lib/services/track-ratings.ts), [counts](../../src/lib/services/play-count.ts), [bookmarks](../../src/lib/services/playback-bookmarks.ts) |
| Sources/scans | [Platform](../../src/platform/README.md), [filesystem contract](../../src/lib/services/platform-files-types.ts), [scanner](../../src/lib/services/library-folder-scanner.ts) |
| Metadata/lyrics | [Reader](../../src/lib/services/media-metadata/reader.ts), stream-meta MP3/FLAC/Ogg/ReplayGain modules, [lyrics](../../src/lib/services/lyrics.ts) |
| Visual assets | [Artwork](../../src/lib/services/stream-artwork.ts), [artwork cache](../../src/lib/services/artwork-cache.ts), [thumbnails](../../src/lib/services/visual-thumbnail-cache.ts), [image session](../../src/lib/services/image-session.ts) |
| DSP/loadouts | [Audio bus](../../src/lib/services/audio-bus.ts), [Raf](../../src/lib/services/raf-engine.ts), [registry](../../src/lib/services/raf-effect-registry.ts), [effects](../../src/lib/services/raf-effects/), [loadouts](../../src/lib/services/loadouts.ts) and tests |
| Lifecycle | [Media Session](../../src/lib/services/media-session.ts), [Vite/PWA](../../vite.config.ts), [updates](../../src/lib/services/pwa-updates.ts), [Android](../../src/android/README.md) |
| Server adoption | [PCM](../../izci-server/internal/media/render.go), [jobs](../../izci-server/internal/media/render_job.go), [sessions](../../izci-server/internal/host/session.go), [SQLite](../../izci-server/internal/persistence/store.go) |

Current browser players/Web Audio and the Go/FFmpeg host are behavior references,
not an existing Rust engine to extract. Port intended outcomes, not old storage
shapes or node topology. A transport anchor does not prove background audio.

- [Corpus contract](../../fixtures/README.md) and [manifest](../../fixtures/manifest.json):
  generation requires exact paired FFmpeg/FFprobe pins. Outputs are ignored;
  preserve digests instead of accepting another build's bytes.
- `audio-opus` is about 0.25 s audible, `module-mod` 7.68 s. Add markers to long
  audio for dropped/duplicate-frame checks. [toneModule](../../src/lib/services/openmpt/test-fixtures.ts)
  supplies MOD/subsong data. Blank Hively is lifecycle only; audible pinned
  XM/S3M/IT/MO3/AHX/HVL inputs remain acquisition work.
- [OpenMPT provenance](../../src/lib/vendor/libopenmpt/README.md),
  [Hively recipe](../../scripts/vendor/ahx/README.md), [notices](../THIRD-PARTY-NOTICES.md):
  keep source/loader/ABI provenance and old runtime assets intact.

## Primary mechanism references

- [Rust interior mutability](https://doc.rust-lang.org/std/cell/struct.UnsafeCell.html):
  atomic indices do not make shared sample storage mutation sound.
- [opusfile](https://opus-codec.org/docs/opusfile_api-0.12/index.html): callbacks,
  seek/timeline, channels, and gain policy.
- [SQLite WASM](https://sqlite.org/wasm/doc/trunk/persistence.md): VFS/ownership/
  initialization requires actual integration proof.
- [File API](https://www.w3.org/TR/FileAPI/), [WebCodecs](https://www.w3.org/TR/webcodecs/):
  worker reads and asynchronous resources; recheck concrete versions/configs.

Source/documentation checks do not substitute for actual runtime evidence.
