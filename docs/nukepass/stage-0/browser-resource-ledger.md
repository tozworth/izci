# Browser resource ledger

| Resource | Acquisition owner | Present cancellation/disposal | Defect / evidence target |
| --- | --- | --- | --- |
| Shared AudioContext/graph | `audio-bus.ts` | Disconnect routes/Raf/analyser/output, stop broadcast, close context via controller destroy | Add diagnostic counts and repeated-destroy evidence |
| Audio Compare AudioContext | `audio-comparison.ts` engine | Engine `destroy()` closes context; app teardown invokes it | Repeated source/tool lifecycle count |
| Editor preview AudioContext | `EditorApp.svelte` | Component destroy closes preview context | Preview replacement/page-close count |
| Editor decode AudioContext | `clip-audio.ts` per decode | Closed after decode in `finally`-equivalent path | Decode failure/cancel count |
| Editor OfflineAudioContext | `clip-effects.ts` per render | Completion-owned browser render context | Effect failure/cancel characterization |
| Module metadata/unknown probe players | `module-metadata.ts`, `file-verification.ts` | Private players/contexts close after probe | Accept/reject/error resource count |
| Howler HTML5 elements | `howler-player.ts` | Stop timers/RAF, disconnect bus, `Howl.unload()` | Browser fallback and replacement CDP |
| Native video element | `video-player.ts` | Unload/exit PiP/remove src; destroy removes element | Listener lifetime and adoption-failure CDP |
| OpenMPT player/worklet | `module-player.ts`, Chiptune3 | Stop/disconnect gain, dispose process node/close port | Replacement/error counts |
| AHX worklet/WASM | `ahx-player.ts` | Dispose message, node/gain disconnect, port close, load token/timeout | Acquisition-failure and repeated destroy |
| Raf nodes/worklets | Raf engine/effects | Engine/effect destroy, timer/interval cleanup | Per-effect node/timer counts |
| Media Session transport anchor | `media-session.ts` | Only pause/deactivate | Hidden audio DOM node and blob URL never removed/revoked—repair |
| Collection object URLs | file utilities/materialization/store plus callers | Store revokes some duplicate/replaced paths; callers clean returned removed items | Split ownership makes missed revocation possible |
| Artwork URLs | stream/album/presentation controllers | Generally reference-counted and revoked on replacement/destroy | Counter and cancellation evidence |
| ImageBitmaps | Artwork rendition generator | Closed in `finally` after canvas encoding | Decode/encode failure must still return to baseline |
| MSE/SourceBuffer | Multiplayer render playback | Generation/session clears timers, graph, src, element, URL, buffers/maps | Real browser generation/range/teardown CDP |
| Received RTC audio | Multiplayer audio | Clear callbacks/route/srcObject/element; peer owns receiver | Stable route and peer teardown counters |
| RTCPeerConnection/channels | Multiplayer peer + host/client | Peer dispose clears timer/queues/Freeplay/PC; PC closes channels | Render pin relies on async channel `onclose`; queue timers untracked |
| Freeplay render graph/media | Multiplayer Freeplay | Tracks/nodes/URLs/timers disposed by peer/player | Assert per-pair isolation and complete peer scope |
| Workers | Multiplayer coordinator; converter/editor jobs | Coordinator clear/crash; job success/error/abort terminate tool workers | Converter page destroy and Troubadour writes lack deterministic cancel |
| Popup windows | Window manager/mini-player | Named reuse; parent/pagehide closes most; Troubadour intentionally survives main | Repeat open/focus/close and orphan behavior |
| Service worker/update timers | PWA updater | Browser registration; no application disposer | Permanent interval/listeners, no idempotence/coordination |
| Workbox CacheStorage | Generated service worker | Workbox owns rebuildable precache/runtime lifecycle | Inspect exact precache, stale versions and offline page behavior |
| IDB connections | Repositories/cache | Mostly per-operation close | Render disk cache process-lifetime connection; no versionchange |
| BroadcastChannels | Settings and focused services | Logging/listener-scoped folder command channels close | Most singleton channels never close |
| Writable streams | Backup/tool export/write owners | Normal success usually closes; exception/cancel abort/close behavior varies and is sometimes realm-dependent | Close/cancel/error/preflight tests per tool |
| AbortControllers | Converter app, Troubadour Loudness and Spectrogram tabs | Job owners abort/replace; converter page and Troubadour controller teardown are incomplete; metadata/remux only consume signals | Count active jobs and assert early/mid/late cancellation |
| Resize/Mutation observers | Workspace/menu/visualizer/editor/Options/mini-player components and helpers | Most Svelte/component cleanup disconnects; ownership is local and uncounted | Repeated mount/unmount baseline |
| MediaQuery/event listeners | Theme, scrollbar, WCO/window state, page roots, components and global services | Readable/component cleanup is mixed with permanent singleton listeners | Listener accounting and idempotent bootstrap evidence |
| Web Animations | `scrollbar-visibility.ts` animation map | Replacements/settled entries are cancelled/removed; teardown cancels all | Animation count after repeated scroll/teardown |
| FileReader | Multiplayer artwork decoding | Event-scoped reader | Abort/error/oversize characterization |
| Launch Queue consumer | `file-launch.ts` | Browser owns consumer; one-time global initialization | Native path remains manual; test adapter must use same app-facing contract |
| Download/export object URLs | Backups, Raf transfer, Logs, Editor and Troubadour export actions | Usually revoked immediately or after a short timeout | Counter must distinguish short-lived expected URLs from leaks after teardown |
| Media Session action handlers | `media-session.ts` | Owner clears registered handlers on disconnect | Assert all actions/metadata/position clear; transport anchor itself still leaks |
| Timers and RAF loops | Playback/backdrops/visualizers/workspace/tools/Multiplayer/PWA owners (110 acquisition call sites in the initial scan) | Many focused owners cancel; singleton/global callbacks and queue-drain timers are not centrally tracked | Per-context counts at baseline, peak, settled and destroy |

Non-settings channels are backup restore, filesystem folders, library folder
commands, loadout track context/manual commands, logging, Raf meters, and file
launch coordination. Several are process singletons without a close lifecycle.

No central counter currently reports workers, timers/RAFs, URLs, elements,
AudioNodes/worklets, BroadcastChannels, databases, peer connections/data
channels, SourceBuffers, popup windows, cache pins, or queued bytes. Stage 1
introduces test-side accounting where it can characterize current behavior;
Stage 2 owns the production lifetime/scope contract.

Additional open defects:

- PWA update registration can duplicate a permanent controller listener,
  interval, and anonymous visibility/focus/online listeners; a timed-out
  controller-change wait also leaves its one-shot listener until a later change.
- Lyrics, palette, and editor AudioBuffer caches are unbounded.
- Troubadour has load generations/optional job abort signals but no controller
  `destroy()` that cancels active writes.
- Metadata writer/remux can acquire an atomic writable before a pre-write failure
  path that does not explicitly abort/close it; Converter output failure likewise
  does not call `abort()` on its writable.
- File-launch cleanup removes only its active-file listener; heartbeat/channel/
  storage/beforeunload ownership remains global.
- Queue-drain RTC timeouts self-quiesce after closure but are neither cancellable
  nor countable.
- Persistence quota and resource acquisition failures are usually swallowed, so
  “clean” teardown cannot be distinguished from degraded behavior.
