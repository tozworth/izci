<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import { desktopSettings, MIN_DESKTOP_ZOOM, MAX_DESKTOP_ZOOM, DEFAULT_DESKTOP_ZOOM } from './settings';
</script>

<SettingsField title={$t('desktop.appearance.zoom.title')} hint={$t('desktop.appearance.zoom.hint')} useLabel={false}>
  <input type="range" min={MIN_DESKTOP_ZOOM} max={MAX_DESKTOP_ZOOM} step="5"
    value={$desktopSettings.zoomPercent} aria-label={$t('desktop.appearance.zoom.title')}
    on:input={(event) => desktopSettings.update({ zoomPercent: Number(event.currentTarget.value) })} />
  <output>{$desktopSettings.zoomPercent}%</output>
  <button type="button" title={$t('desktop.appearance.zoom.reset')}
    aria-label={$t('desktop.appearance.zoom.reset')} disabled={$desktopSettings.zoomPercent === DEFAULT_DESKTOP_ZOOM}
    on:click={() => desktopSettings.update({ zoomPercent: DEFAULT_DESKTOP_ZOOM })}>100%</button>
</SettingsField>

<style>
  input { width: 140px; min-width: 60px; }
  output { min-width: 4ch; margin: 0 8px; text-align: right; font-variant-numeric: tabular-nums; }
</style>
