# Raf settings and controls

The rack uses `izci.raf-settings` / `izci-raf-settings`, normalization in
`raf-settings.ts` and `raf-effect-registry.ts`, and immediate differential
application by `raf-engine.ts`/`raf-effects/*`. The UI is `RafView.svelte`,
`RafEffectsWorkspace.svelte`, `RafEffectEditor.svelte`, and the six focused
editors; desktop and mobile share Options content but the whole Raf page is
hidden/redirected while `playbackSettings.enableRaf` is false. Reset writes an
enabled empty rack. Existing focused tests are `raf-settings.test.ts`,
`raf-effect-registry.test.ts`, `raf-engine.test.ts`, and effect tests; every row
also requires Stage 1 `raf-setting-runtime` and graph/resource telemetry.

For every presented row, the exact accessible label, hint, units, and choice
text are the identity-specific `$t(...)` call in the named editor (or the
generated per-band call in `GraphicEqEditor.svelte` and
`CrystalizerEditor.svelte`). The English and Turkish catalog entries are
`src/lib/i18n/locales/en.json` and `tr.json`; desktop and mobile use the same
editor components. `effects[].id` and `customized` are the two persisted,
non-editable identities called out below rather than silently treating them as
controls.

## Rack and per-instance controls

| Identity | Default / choices | Presentation and condition | Runtime / reset | Disposition |
| --- | --- | --- | --- | --- |
| `enabled` | true; boolean | Raf rack enable | engine bypass; immediate; rack reset | Preserve |
| `effects[]` order | empty; ordered instances of six types | add/reorder/remove controls | engine topology; immediate; rack reset deletes rack | Preserve |
| `effects[].id` | generated constrained ID | not directly editable | stable instance ownership | Preserve |
| `effects[].type` | auto-amp/graphic-eq/stereo-width/crystalizer/sloptimizer/reverb | Add-effect menu; immutable after creation | effect registry | Preserve |
| `effects[].enabled` | true; boolean | instance bypass | engine differential bypass | Preserve |
| `effects[].displayName` | absent; trimmed 1–64 chars | rename action | presentation/log identity | Preserve |
| clone instance | command | instance menu | creates new normalized ID/settings | Preserve |
| reset instance | command | instance menu | replaces parameters with registry defaults | Preserve |

## Auto Amp

Presented by `AutoAmpEditor.svelte`; mode choices off/reduce/increase/dynamic.

| Identity | Default / range | Condition | Disposition |
| --- | --- | --- | --- |
| `gainDb` | 0; -24…24 dB | always | Preserve |
| `mode` | off; off/reduce/increase/dynamic | always | Preserve |
| `targetDb` | -1; -6…0 dB | automatic modes | Preserve |
| `maximumReductionDb` | 24; 0…24 dB | reduce/dynamic | Preserve |
| `maximumBoostDb` | 18; 0…24 dB | increase/dynamic | Preserve |
| `peakHoldSeconds` | 2; 0…10 s | automatic modes | Preserve |
| `recoveryDbPerSecond` | 2; .25…12 dB/s | automatic modes | Preserve |
| `lookaheadMs` | 150; 50…300 ms | automatic modes | Preserve |

Auto Amp telemetry is transient and transported by `raf-auto-amp-meter.ts`; it
is not a setting. Video bypasses this effect only, source-scoped.

## Graphic EQ

Presented by `GraphicEqEditor.svelte`. Every gain defaults to 0 and ranges
-12…12 dB. `bandGainsDb` has exactly ten entries; each is a separate slider.

| Identity | Band |
| --- | --- |
| `preampDb` | preamp |
| `bandGainsDb[0]` | 31 Hz |
| `bandGainsDb[1]` | 62 Hz |
| `bandGainsDb[2]` | 125 Hz |
| `bandGainsDb[3]` | 250 Hz |
| `bandGainsDb[4]` | 500 Hz |
| `bandGainsDb[5]` | 1 kHz |
| `bandGainsDb[6]` | 2 kHz |
| `bandGainsDb[7]` | 4 kHz |
| `bandGainsDb[8]` | 8 kHz |
| `bandGainsDb[9]` | 16 kHz |

All preserve; registry/effect tests plus Stage 1 CDP are required per band.

## Stereo Width

| Identity | Presentation | Default / range | Disposition |
| --- | --- | --- | --- |
| `widthDb` | `StereoWidthEditor.svelte` | 0; -24…24 dB | Preserve |

## Crystalizer

`CrystalizerEditor.svelte` presents 13 derived-frequency bands. For every index
0–12 there are three independent controls under the canonical array fields
`bandIntensities`, `bandMuted`, and `bandBypassed`:
`bandIntensities[index]` defaults 0 and ranges -40…32;
`bandMuted[index]` defaults false; and `bandBypassed[index]` defaults false.
Frequencies/labels derive from
`CRYSTALIZER_FREQUENCIES` in `raf-effects/crystalizer.ts`. All apply
immediately, reset per instance, preserve, and require per-band registry/effect
tests plus Stage 1 CDP.

| Index | Intensity identity | Mute identity | Bypass identity |
| --- | --- | --- | --- |
| 0 | `bandIntensities[0]` | `bandMuted[0]` | `bandBypassed[0]` |
| 1 | `bandIntensities[1]` | `bandMuted[1]` | `bandBypassed[1]` |
| 2 | `bandIntensities[2]` | `bandMuted[2]` | `bandBypassed[2]` |
| 3 | `bandIntensities[3]` | `bandMuted[3]` | `bandBypassed[3]` |
| 4 | `bandIntensities[4]` | `bandMuted[4]` | `bandBypassed[4]` |
| 5 | `bandIntensities[5]` | `bandMuted[5]` | `bandBypassed[5]` |
| 6 | `bandIntensities[6]` | `bandMuted[6]` | `bandBypassed[6]` |
| 7 | `bandIntensities[7]` | `bandMuted[7]` | `bandBypassed[7]` |
| 8 | `bandIntensities[8]` | `bandMuted[8]` | `bandBypassed[8]` |
| 9 | `bandIntensities[9]` | `bandMuted[9]` | `bandBypassed[9]` |
| 10 | `bandIntensities[10]` | `bandMuted[10]` | `bandBypassed[10]` |
| 11 | `bandIntensities[11]` | `bandMuted[11]` | `bandBypassed[11]` |
| 12 | `bandIntensities[12]` | `bandMuted[12]` | `bandBypassed[12]` |

## Sloptimizer

Presented by `SloptimizerEditor.svelte`. Simple mode edits `slop`; advanced mode
exposes the remaining DSP fields. `customized` records divergence from macro
mapping and is not an independent user input. All apply immediately and reset
per instance.

| Identity | Default / range | Condition | Disposition |
| --- | --- | --- | --- |
| `advanced` | false; boolean | mode toggle | Preserve |
| `slop` | 0; 0–100 | simple mode | Preserve |
| `customized` | false; derived boolean | presentation marker | Preserve as derived persisted field; review canonicality |
| `lowLiftDb` | 0; -6…12 dB | advanced | Preserve |
| `midLiftDb` | 0; -6…12 dB | advanced | Preserve |
| `highLiftDb` | 0; -6…12 dB | advanced | Preserve |
| `lowCrossoverHz` | 180; 60…400 Hz | advanced | Preserve |
| `highCrossoverHz` | 3000; 1000…8000 Hz | advanced | Preserve |
| `density` | 0; 0…100 | advanced | Preserve |
| `speed` | 30; 0…100 | advanced | Preserve |
| `upwardRatio` | 1; 1…8 | advanced | Preserve |
| `upwardThresholdDb` | -36; -60…-12 dB | advanced | Preserve |
| `upwardMaximumBoostDb` | 0; 0…24 dB | advanced | Preserve |
| `ceilingDb` | 0; -6…0 dB | advanced | Preserve |

## Reverb

Presented by `ReverbEditor.svelte`.

| Identity | Default / range | Disposition |
| --- | --- | --- |
| `mix` | 18; 0…100 | Preserve |
| `roomSize` | 55; 0…100 | Preserve |
| `decaySeconds` | 2.2; .4…8 s | Preserve |
| `preDelayMs` | 18; 0…120 ms | Preserve |
| `dampingHz` | 9000; 1000…20000 Hz | Preserve |

## Presets and rack transfer

Preset state uses `izci.raf-presets` / `izci-raf-presets`, default empty list and
null selection, normalization in `raf-presets.ts`, and tests in
`raf-presets.test.ts`. `presets[].id`, `.name`, `.settings.effects[]`, and
`selectedPresetId` are distinct persisted identities manipulated by preset
create/save/apply/rename/delete controls. Reset behavior is explicit preset
deletion, not Raf page reset. Preserve.

Rack file/clipboard import/export is a separate non-persisted command surface in
`raf-settings-transfer.ts`: export serializes the current rack only; import
validates and replaces the current rack only. It does not transfer the preset
collection. Tests are `raf-settings-transfer.test.ts`; Stage 1 exercises
clipboard/file success, invalid input, download URL revocation, and rack
replacement.
