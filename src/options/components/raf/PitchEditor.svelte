<script lang="ts">
  import { t } from 'svelte-i18n';
  import { PITCH_SEMITONES_MAX, PITCH_SEMITONES_MIN } from '$lib/services/raf-effects/pitch';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafPitchSettings } from '$lib/types';

  export let settings: RafPitchSettings;

  function updatePitch(event: Event) {
    const semitones = (event.currentTarget as HTMLInputElement).valueAsNumber;
    rafSettings.updateEffect(settings.id, (effect) => ({ ...effect, semitones } as RafPitchSettings));
  }
</script>

<label class="pitch-control">
  <span>{$t('options.raf.pitch.lower', { default: 'Lower' })}</span>
  <input type="range" min={PITCH_SEMITONES_MIN} max={PITCH_SEMITONES_MAX} step="1" value={settings.semitones} on:input={updatePitch} aria-label={$t('options.raf.pitch.semitones', { default: 'Pitch shift' })} />
  <span>{$t('options.raf.pitch.higher', { default: 'Higher' })}</span>
  <output>{settings.semitones > 0 ? '+' : ''}{settings.semitones.toFixed(0)} st</output>
</label>
<p class="pitch-note">{$t('options.raf.pitch.note', { default: 'Realtime granular pitch shift; adds about 85 ms of latency.' })}</p>

<style>
  .pitch-control { width: 100%; min-width: 0; display: grid; grid-template-columns: auto minmax(90px, 1fr) auto 54px; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
  input[type='range'] { width: 100%; accent-color: var(--accent-strong); }
  output { color: var(--text-strong); text-align: right; font-variant-numeric: tabular-nums; }
  .pitch-note { margin: 4px 0 0; color: var(--muted); font-size: 10px; line-height: 1.4; }
</style>
