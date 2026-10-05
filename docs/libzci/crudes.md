# The CLI and the crudes

[Plan entry point](README.md) · [Contracts](contracts.md) ·
[Phases](phases.md) · [Validation](validation.md)

The consumers are deliberately small, independently runnable applications. They
exercise the real engine and adapters. They are not demos powered by mocks, old
izci stores, a browser wrapped as native, or a separate JS runtime implementation.

## 1. zci-play

Provide an aplay-style entry point: open a media source, play it, report failures,
and terminate cleanly on EOF or interruption. Opus is the first useful path.
Add ordinary formats and modules through registered providers. Useful initial
flags are source, output device, volume, start position, and module subsong; exact
syntax is finalized in its implementation.

Default to an in-memory/isolated engine profile. A later explicit profile option
can exercise durable state. Do not open or mutate the ordinary player's profile.
Diagnostics go to stderr; any PCM/file-render mode is explicit and bypasses the
audio device. CLI argument parsing may translate inputs to public commands, but
must not implement playback, metadata inference, or navigation policy itself.

## 2. Native crude

Use native widgets and a simple table/list. Spend effort on complete controls,
observability, and reproducible interactions, not design or UX. Linux is the first
development output path; keep Windows/native portability visible in dependencies
and validation. Android source/grant behavior is a separate adapter concern,
not a reason to force a native APK consumer into the initial scaffold.

Grow the UI as each public capability lands:

| Engine slice | Crude interaction |
| --- | --- |
| Basic transport | Open, play/pause/stop, seek, current state/errors/provider |
| Queue/preparation | Add duplicates, reorder/remove, next/previous, up-next, shuffle/repeat, show preparation |
| Catalog/state | Add/remove roots, rescan/cancel, query library, favorite/rate/bookmark, see counts |
| Media information | Metadata, subsong/channel controls, simple lyrics/pattern inspection |
| Visual assets | Artwork, thumbnails, independent image viewer/navigation |
| Raf/loadouts | Rack order, all useful parameters, presets, matching context and effective settings |
| Video | One plain viewport, track selection, seek, audio/DSP latency and frame diagnostics |

Every domain action is a public command. Every displayed fact comes from a query,
snapshot, or event. Local row selection, widget state, and window geometry remain
local. An unsupported action stays visibly unsupported, rather than being
implemented in the UI to make the demonstration appear complete.

Knob descriptors come from the core's parameter/capability definitions; localized
labels and widget selection are UI resources. If a control is added, its setting
must work without this window open. Reproduce enough current functionality to
shape the engine API; do not reproduce desktop column/layout machinery.

## 3. Crude PWA

The PWA is a maintained peer consumer, not a late compatibility check. It uses
the actual WASM engine, browser sources, SQLite/OPFS wiring, decoder providers,
and audio output. It can have plain HTML controls and diagnostic tables.

Its first useful screen covers reference Opus, optional WebCodecs audio, module
transport, seek/cancellation, output buffering, Media Session, and capability
errors. Add domain/asset/Raf controls when those engine slices land. It need not
mirror every native widget, but it must exercise every browser-relevant contract.

Keep separate install/SW/asset/profile identity from old izci. Test production
installation and offline launch with all required WASM/worklet/provider assets,
not just a development page. Asset size and emitted filenames require explicit
precache ownership; don't inherit the current app's limit without checking the
new artifacts. Updates must keep a running engine on a coherent binding/assets
version and provide a controlled restart into the new version.

### Browser integration and lifecycle

Expose user activation/unlock, source grant states, persistence availability,
codec probes, selected provider, output clock/latency, queue depths, underruns,
and recent bounded errors. A diagnostics view must distinguish requested state
from actual running output.

Media Session metadata/position follows engine state. Actions become commands.
The browser adapter may use the current transport-anchor technique, but must
prove controls independently from continued decoded playback. Test browser tab
and installed-PWA background behavior, screen-off, pause/resume, seek, audio
interruption, and recovery on actual declared targets.

Attach a second window/client and exercise shared settings/catalog updates,
disconnect/reconnect, and host loss. There is one owner for a given playback
session and database namespace; opening a diagnostic/options window must not
start a second decoder, audio output, or SQL owner. Do not require a service
worker to keep a player alive after every window closes.

### Video near the end of core development

Before a viewport, use capability probes and bounded decode tests to check packet
configuration, resource release, stale-generation disposal, and decoder recovery.
Browser video uses WebCodecs and opaque frame handles; no software video codec
bundle or primary `<video>` playback backend is the acceptance target.

Add one minimal viewport when the video phase begins. Prove visible A/V sync,
audio/Raf latency, silent video, fast seeking, hidden-surface suspend/resume,
surface handoff, and resource cleanup. Decoded frames do not traverse Svelte
state or WASM pixel memory merely to display them. A platform-specific OS/PiP
bridge may need extra mechanisms; record that capability separately from the
core video transport and avoid speculative implementation before testing it.

Hardware acceleration and efficient presentation are measured outcomes, not
promises inferred from the presence of WebCodecs. If a browser cannot decode a
configuration, show a supported capability failure. Native providers can support
more formats without silently enlarging the browser bundle.

## 4. Shared acceptance and diagnostics

Give both crudes the same scenario IDs, current API/build identity, and capability
vocabulary. Use the same small media sources and domain command sequences.
Record effects of real interactions rather than duplicating expected results
inside each UI.

Diagnostics may inspect bounded engine state but must not expose mutable engine
internals. Keep test-only fault injection explicit and out of normal persisted
settings. Useful scenarios include delayed reads, denied grants, provider loss,
rapid conflicting seeks, stale job completion, output suspension, database write
failure, and closing a client mid-job.

An awkward interface is acceptable. Requiring it to repair engine state, poll
an internal pointer, write SQL, or duplicate business rules is not. Repair the
contract before expanding the UI. Maintain useful advanced tweaks in the core
when implementing substantial playback/Raf/scanning features; do not spend the
quota on cosmetic controls.
