<script lang="ts">
  import { RAF_GAIN_MAX_DB, RAF_GAIN_MIN_DB } from '$lib/services/raf-effects/graphic-eq';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafMidSideSettings } from '$lib/types';

  export let settings: RafMidSideSettings;

  function updateGain(event: Event, key: 'midGainDb' | 'sideGainDb') {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    rafSettings.updateEffect(settings.id, (effect) => ({ ...effect, [key]: value } as RafMidSideSettings));
  }
</script>

<div class="mid-side-controls">
  {#each [['midGainDb', 'Mid'], ['sideGainDb', 'Side']] as control}
    <label>
      <span>{control[1]}</span>
      <input type="range" min={RAF_GAIN_MIN_DB} max={RAF_GAIN_MAX_DB} step="0.5" value={settings[control[0] as 'midGainDb' | 'sideGainDb']} on:input={(event) => updateGain(event, control[0] as 'midGainDb' | 'sideGainDb')} />
      <output>{settings[control[0] as 'midGainDb' | 'sideGainDb'] > 0 ? '+' : ''}{settings[control[0] as 'midGainDb' | 'sideGainDb'].toFixed(1)} dB</output>
    </label>
  {/each}
</div>

<style>
  .mid-side-controls { width: 100%; min-width: 0; display: grid; gap: 5px; padding: 1px 0; }
  label { min-width: 0; display: grid; grid-template-columns: 3rem minmax(0, 1fr) 5.5rem; align-items: center; gap: 7px; }
  label > span { color: var(--text-strong); font-weight: 600; }
  input { width: 100%; accent-color: var(--accent); }
  output { color: var(--accent-strong); text-align: right; font-variant-numeric: tabular-nums; }
</style>
