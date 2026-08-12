# Options and tool action/control inventory

These controls are not ordinary persisted scalar settings. They are inventoried
so a reconstruction cannot preserve stores while silently dropping commands.
Every row preserves current behavior unless marked repair. Stage 1 assigns each
to a focused contract and/or named CDP scenario.

## Shared Options shell and main Options actions

| Surface | Controls and conditions | Current owner | Required evidence |
| --- | --- | --- | --- |
| Options shell | category/view navigation, hint disclosure, advanced visibility, page reset; desktop popup versus mobile full page/back | `OptionsApp.svelte`, `OptionsContent.svelte`, `OptionsView.svelte`, `MobileOptionsView.svelte` | desktop/mobile parity, conditions, reset-scope CDP |
| Appearance fonts | request/query Local Font Access and select a local family | `AppearanceView.svelte::handleUseLocalFonts`, `local-fonts.ts` | denial/unsupported/success; real permission manual |
| Managed folders | add, drop, check/locate, include/exclude Library, scan-on-launch, scan now, check access, forget | `FoldersView.svelte`, filesystem/folder scan owners | permission/reconcile/cancel/CDP; native picker manual |
| Backups | create/download, open backup, restore, inspect pending folders/loose files, locate/relink | `BackupsView.svelte`, `backups.ts` | round trip, URL revoke, invalid/permission paths |
| Multiplayer render cache | refresh/list, remove one, clear all | `CacheView.svelte`, disk cache | IDB inspection, quota/error, bounds |
| About/update | manual recheck, apply/restart update, Force Update path, licenses navigation, GitHub external action | `AboutView.svelte`, `pwa-updates.ts`, Options views | online/offline/update CDP; external link presence only |
| Raf rack | add/remove/reorder/bypass/rename/clone/reset effect; rack reset; preset create/save/apply/rename/delete; clipboard/file import/export | Raf components, stores, transfer service | graph/settings/resource contracts |
| Loadouts | add, load/apply, update captured values, delete, rename, color, reorder, automatic toggle and capture-category toggles | `LoadoutsView.svelte`, loadout owners | matching/precedence/disabled states/CDP |

## Audio Compare

`AudioCompareApp.svelte`, source panels/menu and `audio-comparison.ts` own:

- open/drop/clear source A and B;
- A/B selection, synchronized transport/seek region, loop and loudness match;
- A-minus-B difference playback;
- Compare versus Blind ABX tab;
- ABX trial count 5/10/20, randomized X, A/B/X audition, guess A/B,
  score/history, start/reset session;
- player volume, keyboard/menu commands, orphan close, and teardown.

All state is transient. Stage 1 `audio-compare-characterization` exercises
source replacement, matching, loop/difference, deterministic ABX policy via
injected IDs/randomness, and resource return.

## Editor

`EditorApp.svelte`, `WaveformEditor.svelte`, dialogs and clip helpers own open/
drop/replace, zoom/scroll/selection, transport/preview, effect preview/apply,
metadata/lyrics edits, export format/options, save-picker/download fallback,
cancel/supersede render, keyboard/menu commands and orphan close. Editor exports
a new file; it does not mutate source metadata through Troubadour's permission
preflight. Preserve load/render cancellation, preview teardown, export fallback,
and failure behavior under Stage 1 `editor-characterization`.

## Converter

`ConverterApp.svelte` and its menu own add files/folder/drop, select/remove/clear
rows, choose output folder, start bounded queue, stop via AbortController,
per-row result/error and output collision decisions. Settings are in `tools.md`.
Repair: page/component destruction does not abort an active job explicitly.

## Logs

Logs app/menu own transient text filter, auto-scroll, copy visible entries,
export/save fallback, clear, column resize/visibility/sort and level filters.
Persistent portions are in `tools.md`; log entries themselves remain transient.

## Troubadour workbench

`TroubadourApp.svelte`, its controller and focused tabs own:

- load current track/selection, picker files/folder/drop, selection, dirty-removal
  confirmation, clear and grouping;
- metadata field editing, raw tags, artwork add/remove/kind/preview, lyrics
  editing/preview, loudness and ReplayGain analysis/write, spectrogram;
- group/album operations, rename template preview, collision/preflight, apply,
  save tags, save-then-rename, undo/history/result synchronization;
- docking/tabs/reset, menu/keyboard commands, separate Options and orphan rules.

Settings are in `tools.md`. Repair active-write/controller teardown ownership;
preserve preview-first and source fingerprint/permission checks. Stage 1
`troubadour-characterization` covers representative jobs and early/mid/late
cancellation/failure.

## Popup and main-menu controls

Main File/View/Playback/Video/Tools/Multiplayer menus, player controls, desktop
selection/context menus, dock/tab commands, mini-player, PiP/fullscreen/theater,
install, and popup open/reuse/focus are covered by the capability ledger. Stage
1's menu/control catalog reporter cross-checks menu IDs/labels/handlers so these
commands cannot disappear behind a preserved settings store.
