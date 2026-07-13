<script lang="ts">
  import {
    CRYSTALIZER_FREQUENCIES,
    CRYSTALIZER_INTENSITY_MAX,
    CRYSTALIZER_INTENSITY_MIN
  } from '$lib/services/raf-effects/crystalizer';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafCrystalizerSettings } from '$lib/types';

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

<div class="crystalizer-bank" aria-label="Multiband crystalizer controls">
  {#each CRYSTALIZER_FREQUENCIES as frequency, index}
    <div class:muted={settings.bandMuted[index]} class:bypassed={settings.bandBypassed[index]} class="crystalizer-band">
      <div class="band-actions">
        <button
          class:active={settings.bandMuted[index]}
          on:click={() => toggleMute(index)}
          title={`${settings.bandMuted[index] ? 'Unmute' : 'Mute'} ${frequency} Hz band`}
          aria-label={`${settings.bandMuted[index] ? 'Unmute' : 'Mute'} ${frequency} Hz band`}
          aria-pressed={settings.bandMuted[index]}
        >M</button>
        <button
          class:active={settings.bandBypassed[index]}
          on:click={() => toggleBypass(index)}
          title={`${settings.bandBypassed[index] ? 'Process' : 'Bypass'} ${frequency} Hz band`}
          aria-label={`${settings.bandBypassed[index] ? 'Process' : 'Bypass'} ${frequency} Hz band`}
          aria-pressed={settings.bandBypassed[index]}
        >B</button>
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
        aria-label={`${frequency} Hz crystalizer intensity`}
      />
      <span class="band-label">{formatFrequency(frequency)}</span>
    </div>
  {/each}
</div>

<p class="hint">Positive values sharpen transients; negative values soften them. Automatic headroom protects the combined output.</p>

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
  .hint { margin: 6px 2px 0; color: var(--muted); font-size: 9px; }
</style>
