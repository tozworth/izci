<script lang="ts">
  import { t } from 'svelte-i18n';
  import { GRAPHIC_EQ_FREQUENCIES, RAF_GAIN_MAX_DB, RAF_GAIN_MIN_DB } from '$lib/services/raf-effects/graphic-eq';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafGraphicEqSettings } from '$lib/contracts/raf';

  export let settings: RafGraphicEqSettings;

  function updatePreamp(event: Event) {
    const preampDb = (event.currentTarget as HTMLInputElement).valueAsNumber;
    rafSettings.updateEffect(settings.id, (effect) => ({ ...effect, preampDb } as RafGraphicEqSettings));
  }

  function updateBand(event: Event, index: number) {
    const gain = (event.currentTarget as HTMLInputElement).valueAsNumber;
    rafSettings.updateEffect(settings.id, (effect) => {
      if (effect.type !== 'graphic-eq') return effect;
      const bandGainsDb = [...effect.bandGainsDb];
      bandGainsDb[index] = gain;
      return { ...effect, bandGainsDb };
    });
  }

  function formatFrequency(frequency: number): string {
    return frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
  }
</script>

<div class="eq-bank" aria-label={$t('options.raf.graphicEq.controls', { default: 'Graphic equalizer controls' })}>
  <label class="eq-control preamp-control">
    <span class="eq-value">{settings.preampDb > 0 ? '+' : ''}{settings.preampDb.toFixed(1)} dB</span>
    <input type="range" min={RAF_GAIN_MIN_DB} max={RAF_GAIN_MAX_DB} step="0.5" value={settings.preampDb} on:input={updatePreamp} aria-label={$t('options.raf.graphicEq.preampGain', { default: 'Preamp gain' })} />
    <span class="eq-label">{$t('options.raf.graphicEq.pre', { default: 'Pre' })}</span>
  </label>
  {#each GRAPHIC_EQ_FREQUENCIES as frequency, index}
    <label class="eq-control">
      <span class="eq-value">{settings.bandGainsDb[index] > 0 ? '+' : ''}{settings.bandGainsDb[index].toFixed(1)}</span>
      <input type="range" min={RAF_GAIN_MIN_DB} max={RAF_GAIN_MAX_DB} step="0.5" value={settings.bandGainsDb[index]} on:input={(event) => updateBand(event, index)} aria-label={$t('options.raf.graphicEq.bandGain', { default: '{frequency} Hz gain', values: { frequency } })} />
      <span class="eq-label">{formatFrequency(frequency)}</span>
    </label>
  {/each}
</div>

<style>
  .eq-bank { width: 100%; max-width: 100%; min-width: 0; display: grid; grid-template-columns: repeat(11, minmax(36px, 1fr)); gap: 3px; overflow-x: auto; overscroll-behavior-inline: contain; padding: 3px 1px 1px; }
  .eq-control { min-width: 36px; display: grid; grid-template-rows: auto 98px auto; justify-items: center; gap: 3px; color: var(--muted); font-size: 0.66rem; }
  .eq-control input { width: 98px; height: 16px; margin: 41px -31px; transform: rotate(-90deg); accent-color: var(--accent); }
  .eq-value { color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .eq-label { font-weight: 600; }
  .preamp-control { border-right: 1px solid var(--border-faint); padding-right: 3px; }
</style>
