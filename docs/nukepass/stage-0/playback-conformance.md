# Playback backend and audio-graph conformance baseline

## Current backend ownership

| Source | Current owner | Preparation/playback facts | Resource and teardown facts | Current coverage / Stage 1 gap |
| --- | --- | --- | --- | --- |
| Regular audio | `HowlerPlayerService` in `howler-player.ts` | Howler with `html5: true`; media element is adopted into Web Audio when possible; rate/true-speed, ReplayGain, seek, transition gain | Howl, element reference, Web Audio media source, event callbacks; `destroy()` disconnects and unloads | Focused coalesced-play/resume tests exist; controller-level rapid replacement and fallback characterization is missing |
| OpenMPT module | `ModulePlayerService` plus `chiptune-loader.ts` and Chiptune3 worklet | Loads a file buffer, exposes subsongs/patterns/metadata, plays in shared AudioContext | Chiptune player/process node/gain and load token; stop/dispose paths exist | Module metadata/worklet behavior has focused tests; backend conformance and cross-backend transition tests are missing |
| AHX/HVL | `HivelyPlayerService` in `ahx-player.ts` plus AHX worklet/WASM | Loads WASM and module bytes into `AudioWorkletNode`; subsongs/patterns/metadata; module settings subset | Worklet node, message port, gain, load token, initialization timeout; stop/destroy posts dispose and disconnects | Worklet/pattern tests exist; common backend conformance and transition coverage is missing |
| Video | `VideoPlayerService` | Native video element; Web Audio adoption where permitted; native volume fallback; rate/true-speed; PiP surface | Long-lived element per service, media source, listeners, fallback RAF; unload clears source and route, destroy removes element | No dedicated video-player test file; fallback, supersession, listener lifetime, and controller transition coverage is missing |
| Multiplayer WebRTC audio | `MultiplayerAudioService` | Received `MediaStream` enters the local Raf chain and is never broadcast-eligible | One remote source route and stream-owned tracks; clear/destroy disconnects route | Focused listener routing/resume-generation tests exist |
| Multiplayer source file | `MultiplayerSourcePlaybackService` through shared `playerController` | Client plays through the native matching backend; Freeplay owns local timeline behavior | Transferred file/object URL lifetime coordinated with prepared/active track | Replacement, repeated snapshot, hidden clock, Freeplay, repeat-one, and shared-start tests exist |
| Multiplayer buffered Opus | `MultiplayerRenderPlayback` | MediaSource-backed element enters shared Web Audio; sparse range/generation logic | Element, object URL, MediaSource/SourceBuffer, source route, queues/ranges/timers | Pure window/recovery tests exist; full MediaSource lifecycle and browser graph behavior remain CDP gaps |
| Multiplayer video RTP | Host/client RTC owners plus receiver presentation | Only live RTP video path | RTCPeerConnection/transceiver/stream/video ownership is distributed across Multiplayer controllers | Multi-profile browser characterization is missing |

`player-controller.ts` is the sole local backend switcher. It currently owns sets
of backend bundles representing active, prepared, and outgoing tracks. Numeric
operation/prepare/load sequences reject some stale work; an outgoing timeout
finishes crossfades. `playback-commands.ts` owns app-level materialize/load/play,
navigation, fade/crossfade selection, and gapless preparation.

There is no focused `player-controller.test.ts`. Existing
`playback-commands.test.ts` covers pure previous-track and transition-policy
helpers, not rapid command sequencing. This is a primary Stage 1
characterization target.

## Current graph invariant

```text
backend source -> per-source transition gain -> per-source local/ReplayGain -> Raf
                       |                                            -> analyser
                       +-> raw program/broadcast tap                 -> master gain
                                                                    -> destination
```

`AudioBusService` creates one shared `AudioContext`, Raf engine, analyser, and
master output. Howler applies stream ReplayGain at the per-source local gain;
native Howler gain is fallback only. Player volume/mute is the post-Raf master
gain. Video bypasses only Auto Amp. Source-gain changes cancel/anchor existing
automation before applying finite ramps.

All normal HTML-media and AudioNode connections are currently broadcast-eligible.
Received WebRTC MediaStreams explicitly are not. Buffered-Opus playback uses the
general HTML-media connection, so whether a receiving client can ever expose
that route to a simultaneous host broadcast is an unresolved ownership defect
to attack in the Multiplayer/browser matrix; the required invariant is that a
received source never feeds a host broadcast tap.

## Required transition characterization

The Stage 1 spine must freeze at least:

- rapid A-to-B-to-C load/transition supersession, including late metadata and
  ended/error callbacks;
- active/prepared/outgoing replacement and repeated teardown;
- no-transition, fadeout, and crossfade with successful and failed preparation;
- play/pause/seek/stop during load and during a crossfade;
- stream, OpenMPT, Hively, and video switches to self and every other backend;
- media-element adoption failure with native volume and transition fallback;
- AudioContext suspended/resume/visibility behavior;
- mute/unmute, zero/logarithmic volume, ReplayGain, Raf reconfiguration, and
  video Auto Amp bypass;
- one intended audible route, correct broadcast eligibility, and settled
  resource counts after replacement/destroy.

Unit fakes establish command/generation semantics. Real-browser CDP establishes
media element, AudioContext, worklet, graph-energy, and cleanup behavior. Neither
is allowed to stand in for physical audible-output sign-off.
