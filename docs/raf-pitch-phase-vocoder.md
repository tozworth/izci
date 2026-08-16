# Raf Pitch phase-vocoder step-up

## Goal

Replace the granular WSOLA pitch shifter behind the Raf Pitch effect with a
realtime phase vocoder (FFT-based), so the "chorus" artifact at larger shifts is
replaced by the milder "phasiness" characteristic of frequency-domain pitch
shifting — and latency drops from ~85 ms to one analysis window (~43 ms).

## Why

The current worklet (`public/raf-pitch.worklet.js`) reads grains from a delay
line at a fixed resample rate and crossfades them with 75% overlap. Causality
forces the read pointer to stay behind the write pointer, which makes
sample-level phase-continuous grains impossible; the bounded WSOLA search
(±256 samples per grain) minimizes but cannot remove the discontinuities. For
low frequencies or shifts near an octave the residual misalignment beats at the
hop rate — the audible "chorus".

A phase vocoder keeps per-bin phase instead of sample-level grain alignment:
each FFT frame's per-bin phase increments are scaled by the pitch factor and
re-synthesized, so the shifted signal is phase-coherent by construction. The
artifact profile changes to transient "phasiness"/smearing at large shifts
instead of steady chorus, and the shift amount no longer trades against a
growing read lag.

## Design

Bernsee-style realtime phase vocoder inside the existing worklet:

- Window: Hann, `N = 2048` (~43 ms @ 48 kHz).
- Hop: `R = N / 4 = 512` (75% overlap; Hann OLA sum is 2, so output scale 0.5).
- FFT: iterative radix-2 implemented inside the worklet (no dependency), N/2+1
  bins, forward without normalization and inverse with 1/N.
- Per bin `k` per frame:
  - `deltaPhase = princarg(phase_now - phase_prev - 2π·k·R/N)`
  - synthesis phase accumulates `pitch · (2π·k·R/N + deltaPhase)`
  - magnitude carried over unchanged.
- Synthesis: ISTFT of `(magnitude, synthesisPhase)`, windowed overlap-add into
  the output stream.
- Latency: one analysis window (~43 ms), down from READ_LAG + grain fade-in
  (~85–105 ms).
- The `pitch` AudioParam and the node plumbing in `raf-effects/pitch.ts` are
  unchanged; only the worklet processor internals change.

> Implemented deviation: a plain bin-grid ISTFT OLA cannot shift pitch. The
> per-hop phase accumulation folds at the hop rate (the OLA only "sees" phase
> differences mod 2π between the four overlapping frames), so the
> resynthesized output stays within roughly half a bin of the analysis bins —
> verified empirically with the accumulator (`accum`), relative-phase
> (`relative`), and deviation-scaled (`deviation`) variants all failing to
> produce an octave shift. The synthesis therefore uses a peak-grouped
> oscillator bank instead: each spectral peak is resynthesized as a single
> oscillator running at `pitch · trueFreq`, with the phase propagated from the
> first frame (`pitch·(φ_m − φ_0) + φ_0`), and the peak's bins' magnitudes
> summed into it. This keeps the per-frame cost proportional to the number of
> peaks (capped at 64, bins below −60 dB dropped) rather than the number of
> bins, and the frames are constant-amplitude oscillators, so the Hann
> synthesis-window OLA sum is 2 and the output scale is `1 / N`. The rest of
> the design (window, hop, FFT, phase tracking, latency) is unchanged.

## Files

- [x] `public/raf-pitch.worklet.js` — replace the granular machinery with the PV
  frame pipeline (input ring buffer, windowed FFT, phase propagation, peak
  oscillator synthesis).
- [x] `src/lib/services/raf-effects/pitch.test.ts` — keep the transparency and
  octave-up/down Goertzel tests; relax the f=1 transparency tolerance (PV is
  near-transparent, not bit-exact like the granular path); add a cleanliness
  check (target-bin magnitude vs the adjacent-bin noise floor) so a regression
  back to granular-style noise fails loudly; add a one-analysis-window latency
  check.
- [x] `src/lib/i18n/locales/en.json`, `tr.json` — update the latency note
  (~85 ms → ~45 ms) in both the Options editor and the Editor dialog, reword
  it from "granular" to "phase-vocoder", and keep the component fallback
  defaults in `PitchEditor.svelte` and `ClipEffectDialog.svelte` in sync.
- [x] This plan — mark the checkboxes done when verified.

No changes expected in `raf-effects/pitch.ts`, `raf-effect-registry.ts`,
`raf-engine.ts`, the Options editors, or `ClipEffectDialog.svelte`: the offline
Editor render path already awaits `effect.ready` and works with any
worklet-backed node, and the worklet URL/processor name stay the same.

## Verification

- [x] `npm run check`
- [x] `npx vitest run src/lib/services/raf-effects/pitch.test.ts` — f=1
  delayed-passthrough within tolerance, octave up/down dominant-bin checks,
  cleanliness ratio, duration preserved.
- [x] `npx vitest run` (full suite)
- [x] `npm run build` — confirm `dist/raf-pitch.worklet.js` is still emitted and
  precached by the service worker.
- [ ] Manual listen: a 440 Hz tone through an octave up sounds clean (no
  hop-rate beating); music at ±7 st shows phasiness only on transients, no
  steady chorus; enabling Pitch while music plays has no click.

## Possible follow-ups (out of scope for this step)

- Phase locking (Puckette / Laroche–Dolson) to reduce transient smearing.
- Adaptive window size for a low-latency mode.
- Shared phase propagation across channels for better stereo coherence.

## Done as a follow-up

- Engine pill in the Pitch editor: the granular WSOLA worklet was restored as
  `public/raf-pitch-granular.worklet.js` (`raf-pitch-granular` processor) and
  can be selected back instead of the phase vocoder via `engine` in the
  settings; `raf-effects/pitch.ts` swaps the worklet node live on switch.
- Finetune knobs replace the single semitones slider: phase-vocoder engine
  exposes window size (1024 / 2048 / 4096, latency ~21 / 43 / 85 ms), max
  oscillators (16 / 32 / 64 / 128) and peak floor (−40 / −60 / −80 dB);
  granular engine exposes grain size (1024 / 2048 / 4096) and WSOLA alignment
  window (128 / 256 / 512). All are k-rate AudioParams applied live.
- Fixing the grain-size knob surfaced a latent granular bug: `ALIGN_MAX`
  allowed the WSOLA read pointer to outrun the write pointer at smaller grain
  sizes; the bound is now `READ_LAG - grainSize` (the maximum read stays
  behind the write at the grain's end), which also sharpens the classic 2048
  behavior.
