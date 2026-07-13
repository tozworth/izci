# izci Raf

## Implementation status

Phase 0 was implemented on 2026-07-13. The typed synchronized store, compile-time effect registry, live crossfading engine, post-Raf analyser routing, ten-band Graphic EQ, normalized Mid/Side processor, and complete Options rack editor are present. Raf is exposed by a default-off Playback setting; its in-page power control remains an independent temporary rack bypass. Automated store, registry, DSP, engine, audio-bus, type/Svelte, and production-build checks pass.

## Final implementation plan

`izci Raf` is a small built-in audio processing rack for izci. It processes both streamed audio and tracker modules through the shared Web Audio output bus while preserving their separate playback transports.

The first deliverable is intentionally narrow: a usable, persistent, reorderable rack with a graphic equalizer and a mid/side gain processor. Later phases add more built-in effects and workflow improvements without changing the rack's core architecture.

## Decisions

- Effects are compiled into the application and registered in an internal effect registry.
- Phase 0 includes only Graphic EQ and Mid/Side.
- Effects can be added, removed, bypassed, and reordered.
- Multiple instances of the same effect type are allowed.
- The default rack is empty and therefore changes no audio.
- Closing the Raf UI does not bypass or remove the active rack.
- Raf applies equally to streams and modules after their existing backend-specific volume handling.
- The visualizer observes the post-Raf signal.
- Raf does not own playback speed, pitch, tempo, ReplayGain, player volume, or mute.
- There is no mandatory limiter, compressor, automatic headroom, gain compensation, loudness matching, clipping prevention, or protected final slot. Users control their own gain staging and effect order.

Finite-value validation and graph failure recovery are still required for software correctness. They must not quietly alter valid user settings in the name of audio safety.

## Product surface

Raf should be an Options page under Playback, alongside the existing module playback settings.

- Add `Raf` to the Options navigation with `parentLabel: 'Playback'`.
- Opening the page shows the live rack editor; changes take effect in the main player immediately.
- Closing the Options window only hides the editor. Processing remains active in the main window.
- Reopening Options restores the current rack order, enabled states, and parameters.
- The page uses the existing Options window entrypoint, navigation, theme, and reset conventions rather than introducing another popup or application entrypoint.

The Options window only edits synchronized settings. It never owns the `AudioContext` or effect graph. The main window's Raf engine subscribes to the same persistent store and remains the sole owner of live processing.

## Audio architecture

The existing shared bus is the foundation:

```text
Howler HTML media element ----+
                              +--> shared bus input --> Raf --> analyser --> destination
Chiptune3 gain output --------+
```

The backend split remains intact:

- Streamed formats continue to use Howler in HTML5 mode. The Howler-owned media element remains the native Chromium transport and enters Web Audio through `MediaElementAudioSourceNode`.
- Tracker modules continue to render through Chiptune3 and its AudioWorklet. Chiptune3 uses the bus-owned `AudioContext` and connects its gain output to the shared bus.
- Raf never decodes files, selects a backend, owns a transport, or mirrors modules through a media element.

The post-Raf analyser means visualization reflects the audio that reaches the destination, including EQ and mid/side changes. A bypassed or empty rack must remain a transparent pass-through.

### Planned graph ownership

`audio-bus.ts` remains responsible for:

- The single long-lived `AudioContext`.
- Adopting and switching the active stream or module source.
- The stable source ingress and final analyser/destination connection.
- Resuming and destroying the shared context.

A new `raf-engine.ts` service owns:

- Stable rack input and output nodes within the bus context.
- Effect instance creation and disposal.
- Connecting effects in persisted order.
- Global rack bypass and per-effect bypass.
- Parameter updates without reconstructing unaffected nodes.
- Graph replacement when effects are added, removed, or reordered.
- Subscribing to the Raf settings store independently of the UI lifecycle.

The bus should connect its ingress to `rafEngine.input`, then connect `rafEngine.output` to the shared analyser. No Svelte component should receive or manipulate `AudioNode`s.

### Graph changes

Changing a parameter should update its existing `AudioParam`; it should not rebuild the rack.

Adding, removing, or reordering an effect requires a topology change. Build the replacement chain completely before making it audible, then perform a short gain crossfade between the old and new chains and dispose the old nodes afterward. This avoids unnecessary gaps and clicks without imposing any gain or dynamics policy on the user.

Global and per-effect bypass should also use short gain ramps or equal-power dry/wet switching. Bypass must not destroy an instance or forget its settings.

If an effect cannot be constructed, the engine should leave that instance bypassed and preserve a dry path so playback continues. This is failure containment, not an audio safety processor. The failure should be reported through the existing application error path where practical.

## Effect model

Every effect is a persisted instance with its own stable ID. The settings model should be a discriminated union rather than a loose property bag.

Conceptually:

```ts
interface RafRackSettings {
  enabled: boolean;
  effects: RafEffectSettings[];
}

interface RafEffectBase {
  id: string;
  enabled: boolean;
}

type RafEffectSettings = GraphicEqSettings | MidSideSettings;
```

Each concrete settings type includes a literal `type` and typed parameters. IDs distinguish duplicate instances and remain stable during reordering.

The default is:

```ts
{
  enabled: true,
  effects: []
}
```

The persisted format supports only the current application version, consistent with izci's scorched-earth compatibility policy. Normalization should reject unknown effect types, duplicate or invalid IDs, non-finite numbers, and malformed parameter arrays. It should preserve valid gain values within the effect's declared control domain; it should not add hidden headroom or automatically reduce boosts.

### Internal effect registry

All built-in effects are declared in one compile-time registry. A definition provides:

- Stable effect type ID.
- Display name and icon.
- Default settings.
- Settings normalization.
- Web Audio node factory.
- Parameter update function.
- Node disposal function.
- UI editor association.

The DSP registry belongs under services and must not import Svelte components. The Raf Options view can maintain the corresponding UI-editor map. Keeping these concerns separate prevents the audio engine from depending on component lifecycle.

Adding a future built-in effect should normally require:

1. Define its typed settings and defaults.
2. Implement its node factory and parameter updates.
3. Register the definition.
4. Add its editor component.
5. Add normalization, graph, and UI tests.

The registry is internal application architecture and can evolve with izci.

## Phase 0 effects

### Graphic EQ

Phase 0 uses a fixed ten-band, one-octave graphic equalizer:

- 31 Hz
- 62 Hz
- 125 Hz
- 250 Hz
- 500 Hz
- 1 kHz
- 2 kHz
- 4 kHz
- 8 kHz
- 16 kHz

Planned parameters:

- Preamp gain in dB.
- Gain in dB for each of the ten bands.

The DSP chain is a preamp `GainNode` followed by ten peaking `BiquadFilterNode`s. Use a fixed bandwidth/Q appropriate for octave-spaced bands and document the selected value beside the implementation. Parameters should be smoothed with short `AudioParam` ramps to avoid zipper noise.

The UI is a compact bank of vertical sliders with numeric dB readouts, a preamp control, and a reset action. Reset returns only that EQ instance to its defaults. Phase 0 does not need editable frequencies, variable Q, spectrum matching, automatic gain, or an EQ curve editor.

### Mid/Side

Phase 0 Mid/Side is deliberately MSED-like but limited to the requested core controls:

- Mid gain in dB.
- Side gain in dB.

Use normalized encode/decode matrices so 0 dB mid and 0 dB side are unity:

```text
M = (L + R) / sqrt(2)
S = (L - R) / sqrt(2)

L = (M + S) / sqrt(2)
R = (M - S) / sqrt(2)
```

The Web Audio graph uses channel splitters/mergers and gain nodes for the positive and negative matrix coefficients. Parameter changes update the mid and side gain nodes with short ramps.

The UI contains two gain controls, numeric dB readouts, and reset. Mid mute, side mute, channel swap, phase inversion, balance, correlation metering, and mono checking are later QoL candidates, not Phase 0 requirements.

## Phase 0 rack interaction

The Raf Options view contains:

- A rack-level enable/bypass control.
- An `Add effect` menu populated from the built-in registry.
- An ordered vertical list of effect cards.
- An empty-state prompt when no effects exist.

Each effect card contains:

- Drag handle.
- Effect name.
- Enable/bypass control.
- Remove action.
- Reset action.
- The effect-specific controls.

Drag-and-drop reorders instances by stable ID. Keyboard-accessible move-up and move-down actions must provide a deterministic alternative to dragging. Reordering updates persistence once per completed move rather than on every pointer movement.

Adding an effect appends a new instance with default parameters. Removing an effect is immediate in Phase 0; undo and confirmation are unnecessary because effects are easy to recreate and this project intentionally does not carry legacy state.

## Persistence and synchronization

Create `raf-settings.ts` using `createPersistentStore`, following the existing lightweight settings pattern:

- `localStorage` key: `izci.raf-settings`.
- `BroadcastChannel` name: `izci-raf-settings`.
- Persist rack enabled state, instance order, per-instance enabled state, and typed parameters.
- Normalize all state on read and on cross-window updates.

The Raf engine subscribes directly to this store. The Options view only edits the store. This keeps processing active when Options is closed and makes state synchronization compatible with future additional izci windows without moving audio processing out of the main window.

Do not store Raf state in IndexedDB or attach it to playlist items. Phase 0 has one global rack, not per-track, per-format, or per-playlist processing.

## Proposed source layout

```text
src/options/components/raf/
  RafView.svelte
  GraphicEqEditor.svelte
  MidSideEditor.svelte
  RafEffectCard.svelte

src/options/
  OptionsApp.svelte             Raf view composition and navigation wiring
  views.ts                      Raf view metadata under Playback

src/lib/services/
  audio-bus.ts                 existing shared context/source owner
  raf-engine.ts                rack topology and store subscription
  raf-effect-registry.ts       built-in definition registry
  raf-effects/
    graphic-eq.ts
    mid-side.ts

src/lib/stores/
  raf-settings.ts

src/lib/types.ts               persisted Raf discriminated unions
```

Pure normalization or ordering helpers may be extracted beside the store or view when that makes them independently testable. Playback and Web Audio graph behavior must remain in services, never in `RafView.svelte` or its editors.

## Phase 0 implementation sequence

1. Add Raf types, defaults, normalization, persistent store, and unit tests.
2. Add the internal effect registry with Graphic EQ and Mid/Side definitions.
3. Add `raf-engine.ts` with a transparent empty/bypassed graph and fake-node lifecycle tests.
4. Insert the engine between the shared bus ingress and analyser.
5. Implement Graphic EQ DSP and parameter update tests.
6. Implement Mid/Side DSP and matrix/topology tests.
7. Add the Raf Options view metadata, navigation, reset wiring, and settings composition.
8. Build the view, effect cards, add/remove/bypass controls, and reorder interaction.
9. Add focused store, registry, ordering, and component-helper tests.
10. Run the full test suite, `npm run check`, and `npm run build` after source changes.
11. Manually verify the installed PWA matrix for both playback paths.

## Phase 0 acceptance criteria

### Rack behavior

- The default empty rack is audibly transparent.
- EQ and Mid/Side instances can be added in any order.
- Multiple instances of either type work.
- Instances can be reordered by dragging and by keyboard-accessible commands.
- Instance bypass, global bypass, remove, and reset work without losing unrelated settings.
- Closing and reopening the Options window preserves processing and UI state.
- Reloading the application restores rack order, enabled states, and parameters.
- Invalid persisted data cannot produce a broken graph or prevent playback.

### Audio behavior

- Streams and modules pass through the same ordered rack.
- Changing EQ audibly affects both backends.
- Mid/side gain audibly affects both backends and is unity at default values.
- The visualizer reflects the post-Raf signal.
- Parameter edits do not restart, seek, pause, or reload playback.
- Adding, removing, bypassing, and reordering do not create obvious gaps or clicks under normal use.
- Player volume, mute, logarithmic volume, and ReplayGain behavior remain upstream and unchanged.

### Chromium regression matrix

Repeat the successful shared-bus checks with an active rack:

- Media popup pause and resume.
- Pause for at least 60 seconds, then resume.
- Natural seek-position updates.
- Seeking from the media popup seek bar.
- Chromium's backward/forward seek buttons.
- Previous and next commands.
- Repeated stream -> module -> stream -> module switching without losing the media surface.
- Player volume and mute, with logarithmic volume both enabled and disabled.

Installed-PWA behavior must be verified manually in an appropriate Chromium surface; the built-in browser is not proof for this integration.

## Future phases

The exact grouping can shift based on use, but additions should build on the Phase 0 registry and engine rather than introduce parallel processing paths.

### Phase A: rack workflow and presets

- Save, rename, load, and delete user rack presets.
- "Clone effect" button.
- Optional compact/expanded card state.
- Input/output meters and clipping indication.

Preset data consists of effect type IDs, order, enabled states, and parameters.

### Phase B: additional built-in effects

- Exciter/crystalizer using a filtered parallel nonlinear path.
- Conventional compressor with explicit threshold, ratio, knee, attack, release, and makeup controls.
- Reverb with wet/dry, pre-delay, and curated built-in impulse responses or a bundled algorithmic implementation.

Custom DSP should use bundled `AudioWorklet` code only when native AudioNodes are insufficient. Worklets and any future WASM are application assets included in the normal build and offline service-worker cache.

### Phase C: maximization and advanced dynamics

- Maximizer/limiter as a normal user-addable effect.
- Multiband compressor or multiband maximizer.
- Crossover controls and per-band metering.
- Gain-reduction history and more detailed output metering.

These processors remain freely reorderable and removable. Raf must not silently append one, lock it to the final slot, or alter another effect to create headroom.

## Documentation maintenance

When Phase 0 lands, update `AGENTS.md` with:

- Raf's service, store, component, and effect directories.
- The final shared-bus graph and analyser position.
- The rule that Raf DSP and topology live in services.
- The global `localStorage`/`BroadcastChannel` persistence contract.
- The compile-time-only built-in effect registry.
- The current Options view behavior and supported effects.

Future effects should also update this document's phase/status sections so `Raf.md` remains the design record rather than a stale wish list.
