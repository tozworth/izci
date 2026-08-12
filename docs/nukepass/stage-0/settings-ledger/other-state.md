# Other user-controlled persisted state

These values are controlled outside a conventional Options field or are durable
presentation/session state. They remain in the Goldilocks ledger because users
can observe and change them.

| Identity | Presentation | State / persistence / reset | Runtime / evidence | Disposition |
| --- | --- | --- | --- | --- |
| Player volume | Player bar slider/wheel/mute controls | `izci.player-volume.v1` / `izci-player-volume`; .85 default, 0–1; no Options reset | controller snapshots only at construction and writes local commands; `volume.test.ts`; Stage 1 cross-window/CDP | Preserve; repair BC update not reaching active controller |
| Mute | Player bar/media commands | transient controller state, false initial | master/fallback immediately | Preserve transient |
| Active Library view | Library navigation | `izci.library-view-settings.v6` / `izci-library-view-settings-v6`; default songs | Playlist panel/navigation; `library-view-settings.test.ts`; CDP | Preserve; backup incorrectly names v5 |
| Library search query | Playlist panel search | same store; empty default | Library projection immediately | Preserve; review whether cross-window durable is intentional |
| Per-view column order | Library table/header | same store; nine column IDs normalized per each of nine views | Library projection | Preserve each view/column |
| Per-view column visibility | Library column menu | same store; per-view defaults | Library projection; ratings also gated by track setting | Preserve each view/column |
| Per-view column width | Header resize | same store; per-column minima/defaults | Library projection | Preserve each view/column |
| Per-view sort column | Header/menu | same store; per-view defaults | Library projection/navigation | Preserve each view |
| Per-view sort direction | Header/menu | same store; asc/desc | Library projection/navigation | Preserve each view |
| Pinned group keys | Group pin controls for artists/albums/genres/years/formats/folders | same store; empty per group view | grouped Library navigation | Preserve each group view |
| Workspace panels/tabs/open/active/current collection/tab order/last-panel memory | Docking, tab and View commands | `izci.workspace-panel-state.v2` / `izci-workspace-panel-state`; defaults in store; no Options reset | `workspace-shell.ts`; focused workspace tests + CDP | Preserve every state field |
| Wide `leftFraction` | resizer | `izci.workspace-panel-layout.v2` / `izci-workspace-panel-layout`; .28 default | layout/workspace immediate | Preserve; exact normalization in expansion |
| Wide `centerFraction` | resizer | same; .42 default | layout/workspace immediate | Preserve; exact normalization in expansion |
| Wide `rightFraction` | resizer | same; .30 default | layout/workspace immediate | Preserve; exact normalization in expansion |
| Loadout `captureCategories[]` membership | Loadouts capture; three playback/Raf/appearance toggles, exact labels in `LoadoutsView.svelte` | `izci.loadout-ui-settings` / `izci-loadout-ui-settings`; default `[playback,raf,appearance]`; no page reset, programmatic store reset only | next capture | Preserve; one ordered unique array, not three object fields |
| Loadout `automaticEnabled` | Loadouts list Auto toggle and list hint in `LoadoutsView.svelte` | `izci.loadouts` / `izci-loadouts`; true; no page reset, programmatic store reset only | matching gate immediately, next track context applies | Preserve |
| `loadouts[]` order | drag-to-reorder saved list | same; empty default; unique valid definitions | first automatic match wins immediately/next track | Preserve |
| `loadouts[].id` | generated, not presented | trimmed max 128, required and unique | stable definition identity | Preserve non-editable |
| `loadouts[].name` | capture text input and rename action | trimmed max 240, required | list/menus and file target fallback | Preserve |
| `loadouts[].color` | Set color submenu | absent or one of the 12 `LOADOUT_COLORS` | list marker | Preserve |
| `loadouts[].target.type` | capture type selector | file/path/type/tags/preset | match dispatch | Preserve |
| `loadouts[].target.fileKey` | inferred from current file for file target | trimmed max 640, required for file | exact-file matcher | Preserve |
| `loadouts[].target.fileName` | inferred/displayed for file target | optional, trimmed max 240 | list label only | Preserve |
| `loadouts[].target.folderId` | inferred for path target | trimmed max 128, required with folder name | managed-folder matcher | Preserve |
| `loadouts[].target.folderName` | inferred/displayed for path target | trimmed max 240, required with folder ID | list and path matcher | Preserve |
| `loadouts[].target.recognizedType` | captured type target | trimmed/lowercase max 80 | recognized-type matcher | Preserve |
| `loadouts[].target.pattern` | capture matcher input for tags target | trimmed max 500, nonempty | tag matcher | Preserve |
| `loadouts[].settings.playback.playbackRate` | captured summary; source control is Playback Options | same normalization/default/range as the enumerated Playback identity | apply through `loadouts.ts` immediately on match | Preserve copied setting |
| `loadouts[].settings.playback.trueSpeed` | captured summary; Playback Options | same boolean normalization as enumerated identity | apply on match | Preserve copied setting |
| `loadouts[].settings.playback.replayGainMode` | captured summary; Playback Options | same choices/default as enumerated identity | apply on match | Preserve copied setting |
| `loadouts[].settings.playback.modules.{repeatCount,stereoSeparation,panStrength,interpolationFilter,tempoFactor,pitchFactor}` | captured summary; Modules Options | exact per-field defaults/ranges are enumerated in `main-options.md` | apply on match with the backend-specific applicability already frozen there | Preserve six copied settings |
| `loadouts[].settings.raf.presetName` | captured summary | trimmed max 80 and required with `enabled` | preset resolution on match | Preserve copied reference; characterize missing preset |
| `loadouts[].settings.raf.enabled` | captured summary | boolean required with preset name | Raf enable/bypass on match | Preserve copied setting |
| `loadouts[].settings.appearance.backdropZones.{left,center,right,player,nowPlaying}` | captured summary; Backdrops Options | each exact choice/default is enumerated in `main-options.md` | apply on match | Preserve five copied settings |
| `loadouts[].settings.appearance.visualizer.{style,colorSource,height,transparency,frameRateLimit,normalizationStrength,triangleCount,triangleMinSize,triangleMaxSize,triangleBaseSpeed,triangleReactiveSpeed,triangleBorderWidth}` | captured summary; Visualizer Options | exact defaults/ranges/conditions are enumerated in `main-options.md` | apply on match | Preserve 12 copied settings |
| `loadouts[].createdAt` | not presented | positive finite rounded timestamp, generated on create | ordering/audit metadata | Preserve non-editable |
| `loadouts[].updatedAt` | not presented | positive finite rounded timestamp, fallback `createdAt` | dirty/update metadata | Preserve non-editable |
| Playback bookmarks map | Player/bookmark behavior | direct `izci-playback-bookmarks`; no BC/reset | bookmark service | Preserve lightweight state; add pruning/failure policy |
| Playback restoration checkpoint | automatic | direct `izci.playback-restoration`; cleared by mode/stop policy | restoration service | Preserve; not a setting control |
| Options active view / advanced visibility | Options navigation/header | direct `izci.options-window-state`; same-origin durable but no reactive sync | Options window only | Preserve presentation state |
| Popup size by popup ID | user window resize | direct `izci.popup-window-sizes`; same-origin durable, no reactive sync | popup window state | Preserve |
| Install hint acknowledgment | install hint dismissal | direct `izci-install-hint-acknowledged` | install service | Preserve |
| Troubadour Options page/advanced | tool Options navigation | direct `izci.troubadour-options-window-state` | Troubadour Options only | Preserve |
| Troubadour dock layout/tabs | workbench docking/reset | `izci.troubadour-workspace.v1` / `izci-troubadour-workspace` | workbench layout; store tests | Preserve |
| Receive Audio | desktop/mobile Multiplayer action | direct `izci.multiplayer.receive-audio`; true unless explicitly false; no BC | receiver route/current session | Preserve; decide local-session vs synchronized semantics |
| Multiplayer recents | join/recents/forget controls | `izci.multiplayer.recents` / `izci-multiplayer-recents`; last five | session UI/next join | Preserve |
| Multiplayer pairings | pair/forget controls | `izci.multiplayer-pairings` / `izci-multiplayer-pairings` | paired rejoin/auth | Preserve |
| Multiplayer last session | automatic restore plus leave/restore controls | `izci.multiplayer-last-session` / `izci-multiplayer-last-session` | startup/session | Preserve |
| Freeplay resume record | Freeplay queue/current selection | `izci.multiplayer-freeplay-state` / `izci-multiplayer-freeplay-state`; one nullable last-host record | session/client restore | Repair: desired per-pair persistence, current new host overwrites prior |
| PWA last successful check | automatic/manual update | direct localStorage `izci.pwa-update-last-successful-check` | update throttling | Preserve coordination; not backup |
| PWA completed-update notice | automatic | sessionStorage `izci.pwa-update-completed` | next-page toast | Preserve session-only |
| File-launch primary claim | automatic cross-window coordination | direct localStorage lease plus channel | Launch Queue primary selection | Preserve transient coordination; never backup |

The exact Library Cartesian and workspace identities/defaults are expanded in
`library-workspace.md`. Stage 1's reporter validates that frozen expansion
against source; it is not the first place those identities are declared.
