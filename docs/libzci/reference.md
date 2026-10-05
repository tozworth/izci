# Codebase discovery reference

[Plan entry point](README.md) · [Boundaries](boundaries.md) ·
[Scaffolding](scaffolding.md) · [Phases](phases.md)

Read-only discovery for this plan was performed on 2026-10-05. These are behavior
and provenance references, not instructions to copy the current runtime into
libzci. Follow code and current operating rules if archived plans disagree.

## 1. Playback, providers, and browser integration

| Reference | Useful evidence |
| --- | --- |
| [player-controller.ts](../../src/lib/services/player-controller.ts), [playback-commands.ts](../../src/lib/services/playback-commands.ts) | Backend ownership, prepared/outgoing bundles, cancellation and sequencing |
| [howler-player.ts](../../src/lib/services/howler-player.ts), [video-player.ts](../../src/lib/services/video-player.ts) | Current HTML5-audio and literal video-element implementation; not reusable native engines |
| [openmpt](../../src/lib/services/openmpt/), [module-player.ts](../../src/lib/services/module-player.ts) | Inspection/worklet separation, ABI, source loading, module settings/pattern capabilities |
| [libopenmpt provenance](../../src/lib/vendor/libopenmpt/README.md) | Pinned WASM/generated-loader origin; native source/toolchain still needs establishing |
| [Hively recipe](../../scripts/vendor/ahx/README.md), [C wrapper](../../scripts/vendor/ahx/ahx-wrapper.c) | Pinned upstream source, interpolation/pattern APIs, mutable-global native isolation hazard |
| [third-party notices](../THIRD-PARTY-NOTICES.md) | Browser/server Hively artifacts differ; server source revision is unverified |
| [media-session.ts](../../src/lib/services/media-session.ts) | Transport handlers and hidden eight-second low-amplitude WAV anchor, separate from real audio |
| [VideoStage](../../src/lib/components/workspace/VideoStage.svelte), [ImageStage](../../src/lib/components/workspace/ImageStage.svelte) | Current element mounting; future surface consumers must preserve single ownership |
| [vite.config.ts](../../vite.config.ts), [pwa-updates.ts](../../src/lib/services/pwa-updates.ts) | Current production SW/offline/assets/update constraints, including precache size limits |
| [Android runtime notes](../../src/android/README.md) | SAF/headless workflow; screen-off/background/notification acceptance remains deferred |

There is no dedicated shared WebCodecs video player to extract today. Existing
tools use browser-oriented media processing libraries, but the new video
transport/provider integration is new work. The transport anchor does not prove
background decoder/output survival.

## 2. Domain, sources, and visual assets

| Reference | Useful evidence |
| --- | --- |
| [types.ts](../../src/lib/types.ts), [queue.ts](../../src/lib/stores/queue.ts), [queue-persistence.ts](../../src/lib/stores/queue-persistence.ts) | Durable/runtime fields currently mixed; separate queue/library/favorites IDB snapshots; duplicate queue semantics |
| [workspace-collections.ts](../../src/lib/services/workspace-collections.ts), [track-ratings.ts](../../src/lib/services/track-ratings.ts) | Half-star ratings copied between rows today; favorites include subsong membership |
| [play-count.ts](../../src/lib/services/play-count.ts), [playback-bookmarks.ts](../../src/lib/services/playback-bookmarks.ts) | Library-only continuous-play counts; localStorage bookmarks and path/fallback keys |
| [loadouts](../../src/lib/services/loadouts.ts), [loadout store](../../src/lib/stores/loadouts.ts) | Context matching mixes playback/Raf/appearance; current tag matching uses JS RegExp |
| [platform README](../../src/platform/README.md), [filesystem contract](../../src/lib/services/platform-files-types.ts) | Genuine FSA handles vs native paths/SAF URIs, capabilities, ranged access |
| [filesystem-folders.ts](../../src/lib/services/filesystem-folders.ts), [library-folder-scanner.ts](../../src/lib/services/library-folder-scanner.ts) | Folder domain data currently mixed with handles; no launch prompts; owned reconciliation |
| [files.ts](../../src/lib/utils/files.ts), [native-media-files.ts](../../src/lib/utils/native-media-files.ts) | Current identity rules differ; preserve platform case instead of copying generic lowercasing |
| [stream-artwork.ts](../../src/lib/services/stream-artwork.ts), [metadata reader](../../src/lib/services/media-metadata/reader.ts) | Custom stream readers plus Mediabunny workbench parser; artwork and tag-writing scope differ |
| [artwork-cache.ts](../../src/lib/services/artwork-cache.ts), [visual-thumbnail-cache.ts](../../src/lib/services/visual-thumbnail-cache.ts) | Separate bounded rebuildable caches; current budgets are references, not schema compatibility |
| [image-session.ts](../../src/lib/services/image-session.ts), [image-viewer.ts](../../src/lib/services/image-viewer.ts) | Captured image sequence, independent transport, URL ownership; currently browser Image decoding |

Useful domain scenarios already live in queue navigation/dedupe/hydration/folder
reconciliation tests, platform filesystem/reference tests, and play-count,
bookmark, rating, loadout, artwork-cache, thumbnail, and image-session tests.
Translate their intended outcomes; do not reproduce old storage object shapes.

## 3. Raf and headless hosting

| Reference | Useful evidence |
| --- | --- |
| [audio-bus.ts](../../src/lib/services/audio-bus.ts), [raf-engine.ts](../../src/lib/services/raf-engine.ts) | Signal ownership, smooth differential updates, rack topology changes and temporary bypass |
| [effect registry](../../src/lib/services/raf-effect-registry.ts), [effects](../../src/lib/services/raf-effects/) | Eight effects and meaningful knobs; registry currently mixes presentation and construction |
| [Raf settings](../../src/lib/stores/raf-settings.ts), [transfer helpers](../../src/lib/services/raf-settings-transfer.ts) | Old localStorage/BC and JSON preset surfaces; no migration/import obligation |
| [server PCM producers](../../izci-server/internal/media/render.go), [render jobs](../../izci-server/internal/media/render_job.go) | Device-free PCM seam, FFmpeg encoding, bounded render/cache behavior |
| [server libopenmpt](../../izci-server/internal/media/openmpt.go), [Hively](../../izci-server/internal/media/hively.go) | Native library loading versus wazero-isolated replay; not a full local device player |
| [server sessions](../../izci-server/internal/host/session.go), [delivery boundary](../../izci-server/internal/host/delivery.go) | Shared/Freeplay timelines and remote preparation distinct from decode/render jobs |
| [server SQLite](../../izci-server/internal/persistence/store.go) | Catalog/queue/identity storage precedent; current schema is not the new core schema |
| [fixture corpus](../../fixtures/README.md), [app protocol fixtures](../../tests/multiplayer-protocol/README.md) | Deterministic provenance and shared behavior transcripts; candid format gaps |

Pitch and upward compression have custom worklets; other effects rely heavily
on browser filters, compressors, gains/delays, convolution, and waveshaping.
Current tests include topology/parameter checks and synthetic signal tests, not
an old-sound golden corpus. Use effect-property tests for the new implementation.

The server currently decodes ordinary audio/video via FFmpeg, modules via native
libopenmpt, Hively via embedded WASM, then encodes buffered Opus/WebM. Its host
clock coordinates delivery rather than driving a local audio device. Those are
useful later integration seams, not a reason to turn the Go host into libzci.

## 4. Primary platform references

- [Rust native C interoperability](https://doc.rust-lang.org/stable/embedded-book/interoperability/rust-with-c.html).
- [Rust WASM target constraints](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html).
- [SQLite OPFS persistence](https://sqlite.org/wasm/doc/trunk/persistence.md): VFS/worker/concurrency choices require an integration proof.
- [FSA handle persistence](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access): handles use browser structured-clone storage rather than SQL serialization.
- [Reference Opus file API](https://opus-codec.org/docs/opusfile_api-0.12/index.html).
- [WebCodecs specification](https://www.w3.org/TR/webcodecs/) and [browser frame handling](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs): configuration support, asynchronous decode, external frames, resource/lifecycle behavior.

Recheck upstream behavior while implementing. Browsing/API documentation and
code discovery do not substitute for installed-PWA or real-device measurements.
