<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import {
    MAX_PLAY_COUNT_THRESHOLD_SECONDS, MIN_PLAY_COUNT_THRESHOLD_SECONDS,
    metadataSettings, normalizePlayCountThresholdSeconds
  } from '$lib/stores/metadata-settings';

  function handleMetadataToggle(event: Event) {
    metadataSettings.update({ inferFromFilename: (event.currentTarget as HTMLInputElement).checked });
  }
  function handlePlayCountThresholdChange(event: Event) {
    metadataSettings.update({ playCountThresholdSeconds: normalizePlayCountThresholdSeconds((event.currentTarget as HTMLInputElement).value) });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.metadata.heading', { default: 'Metadata Behavior' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.metadata.inferFromFilename.title', { default: 'Infer artist/title from filename' })} checkbox>
          <input
            type="checkbox"
            checked={$metadataSettings.inferFromFilename}
            on:change={handleMetadataToggle}
          />
        <svelte:fragment slot="hint">{$t('options.metadata.inferFromFilename.hintBeforeExample', { default: 'When enabled, izci parses filenames like' })} <code>Artist - Title.ext</code> {$t('options.metadata.inferFromFilename.hintAfterExample', { default: 'into metadata fields.' })}</svelte:fragment>
      </SettingsField>

      <SettingsField
        title={$t('options.metadata.playCountThreshold.title', { default: 'Count track as played after (seconds)' })}
        hint={$t('options.metadata.playCountThreshold.hint', { default: 'Only tracks that are in the library update their play count.' })}
        advanced
      >
          <input
            type="number"
            min={MIN_PLAY_COUNT_THRESHOLD_SECONDS}
            max={MAX_PLAY_COUNT_THRESHOLD_SECONDS}
            step="1"
            value={$metadataSettings.playCountThresholdSeconds}
            on:change={handlePlayCountThresholdChange}
          />
      </SettingsField>
    </div>
  </div>
</article>
