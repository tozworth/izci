# Dependency and ownership map

Surveyed at the Stage 0 oracle-derived tree with a one-off literal static-import
scan (the reproducible reporter is a Stage 1 artifact). It covered
464 TypeScript/Svelte files (95,780 TypeScript/Svelte/CSS lines) and found no
strongly connected component larger than one. That is useful current evidence,
not an architecture guarantee: dynamic access, browser globals, callbacks, and
shared singleton state do not appear as import cycles.

## Current owners

| Context | Canonical current owners | Current consumers |
| --- | --- | --- |
| Main composition | `src/main.ts`, `src/App.svelte` | Desktop/mobile components, nearly every application service/store |
| Page bootstraps | `src/options/main.ts`, `src/tools/*/main.ts` | Seven non-main pages; theme/localization/logging/window setup is repeated |
| Desktop/mobile presentation | `src/lib/components/`, `src/mobile/`, `src/options/` | Services and stores are imported directly by many views |
| Workspace coordination | `workspace-shell.ts`, `workspace-actions.ts`, panel state/layout stores | Main root and workspace components |
| Collection state | `src/lib/stores/playlist.ts` facade plus persistence, materialization, metadata, selection, navigation, and dedupe siblings | Main root, workspace/presentation, playback commands, tools handoff |
| Playback orchestration | `player-controller.ts`, `playback-commands.ts` | Main root, Media Session/restoration/play-count integration, Multiplayer source playback |
| Audio/DSP | `audio-bus.ts`, `raf-engine.ts`, `raf-effects/`, volume/settings owners | All local backends, Multiplayer receiver/render paths, visualizer |
| Files/metadata | `utils/files.ts`, import/folder/materialization services, `media-metadata/`, module/stream metadata owners | Collections, playback, artwork, tools |
| Persistence/settings | Focused `src/lib/stores/*` modules plus IDB-owning services | Main/Options/mobile/tool pages and runtime services |
| Browser/PWA/window integration | Import, launch, install/update, Media Session, WCO, popup/window services and Vite config | Main/page roots and menus |
| Multiplayer | Session, host, client, signaling, peer, delivery/render/cache/Freeplay services and focused stores | Main root and Multiplayer presentation |
| Tools | Each `src/tools/<tool>/` subtree; shared metadata/logging/window services | Its page root and explicit cross-window handoff channels |
| Build/deployment | `package.json`, `vite.config.ts`, `prepare-sites-build.mjs`, `sites-worker.js`, Firebase/Hosting config | Vite, Workbox, Firebase emulator/deploy and Sites packaging |

## Observed import pressure

The static scan resolved these high-level edges (tests included): 80 root-to-
service, 15 root-to-store, 88 view-to-service, 59 view-to-store, 349 service-to-
service, 66 service-to-store, 12 store-to-service, and 6 service-to-view imports.
`App.svelte` alone has 74 import declarations and 71 resolved internal edges.
Other high-pressure roots are `PlaylistPanel.svelte`, `TroubadourApp.svelte`,
`multiplayer-client.ts`, `OptionsContent.svelte`, `EditorApp.svelte`,
`multiplayer-host.ts`, and `MobileWorkspace.svelte`.

Browser globals are also not confined to adapters. A simple presence scan found
them in 20 component files, 13 Options files, 5 mobile files, 30 tool files, 94
service files, and 6 store files. Stage 1 architecture tooling reports these
facts without failing the baseline; later stages ratchet reconstructed domains.

## Known reverse or presentation-coupled edges

Production edges that contradict the eventual target direction are mapped, not
silently grandfathered:

- Collection stores call metadata/artwork/logging/rating services
  (`playlist*.ts`, `playlist-materialization.ts`, `playlist-persistence.ts`).
- Raf settings import the DSP effect registry.
- Troubadour workspace state imports docking component types and the dock-layout
  service.
- Window/options services import `src/options/views.ts`.
- `mini-player.ts` imports the Svelte mini-player component.
- Dock/workspace/library services import presentation-owned docking/workspace
  types and a runtime library-view helper/types surface.

These are ownership defects for Stages 2, 3, 6, 7, and 8. Stage 0 does not move
them because the behavior contract and ports do not yet exist.

## Frozen target direction

```text
page roots / Svelte views
        -> application view models and commands
        -> domain controllers, actors, repositories
        -> browser capability and resource adapters
        -> Chromium APIs, IndexedDB, localStorage, Firebase, workers/worklets
```

Pure domain policy and data types may flow upward. Domain controllers may not
import components; browser adapters may not import presentation; Multiplayer
wire types may not import application projections. A tiny shared type surface is
allowed only when it makes ownership explicit.

## Current shared-contract defects

- `src/lib/types.ts` combines media, playback, DSP, settings, workspace, menu,
  collection, and presentation facts.
- `multiplayer-protocol.ts` imports application-wide Playlist item, playback
  snapshot, metadata, and repeat-mode contracts from that bucket, directly
  coupling the wire layer to application/domain projections.
- Browser capabilities (clock, IDs, storage, files, workers, windows) are mostly
  accessed as globals/singletons, making deterministic orchestration tests hard.
- Resource teardown is hand-built per owner rather than registered under one
  inspectable lifetime contract.
- Page bootstrap behavior is repeated across main, Options, and six tool roots.
- There is no enforced import-direction rule. The Stage 1 reporter captures the
  baseline before later stages turn selected violations into errors.
