<script lang="ts">
  import SettingsField from '../SettingsField.svelte';
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
    <h2>Metadata Behavior</h2>
    <div class="field-grid">
      <SettingsField title="Infer artist/title from filename" checkbox>
          <input
            type="checkbox"
            checked={$metadataSettings.inferFromFilename}
            on:change={handleMetadataToggle}
          />
        <svelte:fragment slot="hint">When enabled, izci parses filenames like <code>Artist - Title.ext</code> into metadata fields.</svelte:fragment>
      </SettingsField>

      <SettingsField
        title="Count track as played after (seconds)"
        hint="Only tracks that are in the library update their play count."
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
