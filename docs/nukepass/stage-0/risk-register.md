# Initial nukepass risk register

Severity and likelihood are initial survey values. Later evidence updates them;
it never erases the original failure mode.

| ID | Failure mode | Initial risk | Present owner/evidence target | Stop condition or containment |
| --- | --- | --- | --- | --- |
| R-01 | Playlist/library IDs, play counts, handles, or other non-rebuildable state is lost or crossed between stores | Critical / medium | Collection persistence, handle storage, backup registry; inspect real IDB records and restore tests | Stop before schema/cutover; use a new current-version store only with declared reset consequence |
| R-02 | Playback becomes silent during backend adoption, AudioContext suspension, or transition | Critical / medium | Player controller, backend adapters, audio bus; backend matrix plus graph telemetry | Return to last accepted playback checkpoint on unexplained silence |
| R-03 | Two audible routes survive a transition or media-element fallback | Critical / medium | Player controller/audio bus; route/resource counts and analyser evidence | Stop on any unexplained double route |
| R-04 | Stale load/seek/end/metadata work mutates the new active track | High / high | Playback/application generation ownership; rapid A-to-B-to-C contracts | Do not mask with timing; identify the canonical generation owner |
| R-05 | Render, transfer, metadata, artwork, worker, or persistence queues grow without bound | High / medium | Queue/cache owners and resource ledger; peak/settled counters | Reject unbounded policy or unknown teardown owner |
| R-06 | PWA serves stale code or mismatched worklet/WASM after update | Critical / medium | Vite/PWA update owners; artifact and online/offline/update CDP | Stop if exact build identity cannot be proven |
| R-07 | Launch/rescan requests file permission without user intent | High / medium | Handle/materialization/folder-scan owners; injected permission scenarios | Stop launch-scan slice on any prompt path |
| R-08 | Metadata writes corrupt unknown tags, artwork, lyrics, or source files | Critical / medium | Shared metadata writers and tool preflight; round trips and cancellation | Preserve originals; stop tool cutover on unexplained byte/metadata loss |
| R-09 | Tool cancellation leaves workers, URLs, media, subscriptions, or partial writes | High / high | Per-tool controllers/jobs; early/mid/late cancellation counters | No tool stage passes with retained resources or ambiguous write completion |
| R-10 | Multiplayer protocol source and Firebase rules drift | Critical / medium | Protocol source/sync script/rules suite; non-writing check before builds | Never accept an unpaired protocol/rules change |
| R-11 | Host/client authority or per-pair Freeplay isolation is violated | Critical / medium | Multiplayer session/host/client/Freeplay owners; actor and multi-profile tests | Stop on any Freeplay mutation of shared host playlist/player |
| R-12 | Reconnect or generation replacement retains peers, channels, MSE state, cache pins, timers, or stale messages | High / high | Peer/generation scopes; simulation and CDP teardown deltas | Replacement must be identity-safe and idempotently disposable |
| R-13 | Settings disappear, reset incorrectly, duplicate across windows, or stop affecting runtime | High / high | Setting ledger and store/runtime consumers; collision/reset CDP | No control is removed without a recorded product decision |
| R-14 | Desktop density, keyboard/focus, narrow-desktop behavior, or mobile gesture order regresses | High / medium | Workspace/desktop/mobile presentation; screenshots and interaction matrix | Reject website-like redesign or mobile/desktop boundary drift |
| R-15 | Build entries, popup routes, navigation denylist, or runtime assets diverge | High / medium | Vite, window registry, worklet/worker owners; artifact assertions | Every declared page and asset must boot from the exact build |
| R-16 | A “performance” change hides work, removes behavior, or introduces heuristic races | High / medium | Performance budgets and behavioral contracts | Optimize only measured causes after correctness baseline |
| R-17 | Baseline depends on local profile, unlicensed fixtures, fixed debug ports, or an unavailable browser path | High / high | Fixture manifest and CDP launcher; clean profile/install reproduction | Harness must accept an executable and allocate/discover ports |
| R-18 | Browser-only evidence is claimed for installed PWA, file handlers, audible output, Android, or real-network behavior | High / medium | Residual manual/device checklist | Keep result explicitly unverified until exercised on target device |
