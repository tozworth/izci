<script lang="ts">
  import { t } from 'svelte-i18n';
  import {
    CRYSTALIZER_FREQUENCIES,
    CRYSTALIZER_INTENSITY_MAX,
    CRYSTALIZER_INTENSITY_MIN
  } from '$lib/services/raf-effects/crystalizer';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafCrystalizerSettings } from '$lib/contracts/raf';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';

  export let settings: RafCrystalizerSettings;

  function updateBand(changes: Partial<Pick<RafCrystalizerSettings, 'bandIntensities' | 'bandMuted' | 'bandBypassed'>>) {
    rafSettings.updateEffect(settings.id, (effect) => {
      if (effect.type !== 'crystalizer') return effect;
      return { ...effect, ...changes };
    });
  }

  function updateIntensity(event: Event, index: number) {
    const bandIntensities = [...settings.bandIntensities];
    bandIntensities[index] = (event.currentTarget as HTMLInputElement).valueAsNumber;
    updateBand({ bandIntensities });
  }

  function toggleMute(index: number) {
    const bandMuted = [...settings.bandMuted];
    bandMuted[index] = !bandMuted[index];
    updateBand({ bandMuted });
  }

  function toggleBypass(index: number) {
    const bandBypassed = [...settings.bandBypassed];
    bandBypassed[index] = !bandBypassed[index];
    updateBand({ bandBypassed });
  }

  function formatFrequency(frequency: number): string {
    if (frequency >= 1000) return `${(frequency / 1000).toFixed(frequency % 1000 === 0 ? 0 : 1)}k`;
    return `${frequency}`;
  }
</script>

<div class="crystalizer-bank" aria-label={$t('options.raf.crystalizer.controls', { default: 'Multiband crystalizer controls' })}>
  {#each CRYSTALIZER_FREQUENCIES as frequency, index}
    <div class:muted={settings.bandMuted[index]} class:bypassed={settings.bandBypassed[index]} class="crystalizer-band">
      <div class="band-actions">
        <button
          class="hover-tooltip-anchor"
          class:active={settings.bandMuted[index]}
          on:click={() => toggleMute(index)}
          aria-label={settings.bandMuted[index]
            ? $t('options.raf.crystalizer.unmuteBand', { default: 'Unmute {frequency} Hz band', values: { frequency } })
            : $t('options.raf.crystalizer.muteBand', { default: 'Mute {frequency} Hz band', values: { frequency } })}
          aria-pressed={settings.bandMuted[index]}
        >M<HoverTooltip>{settings.bandMuted[index]
          ? $t('options.raf.crystalizer.unmuteBand', { default: 'Unmute {frequency} Hz band', values: { frequency } })
          : $t('options.raf.crystalizer.muteBand', { default: 'Mute {frequency} Hz band', values: { frequency } })}</HoverTooltip></button>
        <button
          class="hover-tooltip-anchor"
          class:active={settings.bandBypassed[index]}
          on:click={() => toggleBypass(index)}
          aria-label={settings.bandBypassed[index]
            ? $t('options.raf.crystalizer.processBand', { default: 'Process {frequency} Hz band', values: { frequency } })
            : $t('options.raf.crystalizer.bypassBand', { default: 'Bypass {frequency} Hz band', values: { frequency } })}
          aria-pressed={settings.bandBypassed[index]}
        >B<HoverTooltip>{settings.bandBypassed[index]
          ? $t('options.raf.crystalizer.processBand', { default: 'Process {frequency} Hz band', values: { frequency } })
          : $t('options.raf.crystalizer.bypassBand', { default: 'Bypass {frequency} Hz band', values: { frequency } })}</HoverTooltip></button>
      </div>
      <span class="band-value">{settings.bandIntensities[index] > 0 ? '+' : ''}{settings.bandIntensities[index].toFixed(0)}</span>
      <input
        type="range"
        min={CRYSTALIZER_INTENSITY_MIN}
        max={CRYSTALIZER_INTENSITY_MAX}
        step="1"
        value={settings.bandIntensities[index]}
        disabled={settings.bandMuted[index] || settings.bandBypassed[index]}
        on:input={(event) => updateIntensity(event, index)}
        aria-label={$t('options.raf.crystalizer.bandIntensity', { default: '{frequency} Hz crystalizer intensity', values: { frequency } })}
      />
      <span class="band-label">{formatFrequency(frequency)}</span>
    </div>
  {/each}
</div>

<style>
  .crystalizer-bank { width: 100%; max-width: 100%; min-width: 0; display: grid; grid-template-columns: repeat(13, minmax(39px, 1fr)); gap: 3px; overflow-x: auto; overscroll-behavior-inline: contain; padding: 3px 1px 1px; }
  .crystalizer-band { min-width: 39px; display: grid; grid-template-rows: auto auto 98px auto; justify-items: center; gap: 3px; color: var(--muted); font-size: 0.66rem; transition: opacity 120ms ease; }
  .crystalizer-band.muted,
  .crystalizer-band.bypassed { opacity: 0.58; }
  .band-actions { display: flex; gap: 2px; }
  button { width: 17px; height: 17px; padding: 0; border: 1px solid var(--border-faint); border-radius: 3px; background: transparent; color: var(--muted); font-size: 8px; font-weight: 700; }
  button:hover,
  button.active { border-color: var(--accent-strong); color: var(--accent-strong); background: var(--hover-surface); }
  input { width: 98px; height: 16px; margin: 41px -29px; transform: rotate(-90deg); accent-color: var(--accent); }
  input:disabled { opacity: 0.45; }
  .band-value { color: var(--text); font-variant-numeric: tabular-nums; }
  .band-label { font-weight: 600; }
</style>
