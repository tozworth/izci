<script lang="ts">
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
      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Infer artist/title from filename</span>
        </div>
        <div class="field-control field-control-checkbox">
          <input
            type="checkbox"
            checked={$metadataSettings.inferFromFilename}
            on:change={handleMetadataToggle}
          />
        </div>
        <p class="field-hint">When enabled, izci parses filenames like <code>Artist - Title.ext</code> into metadata fields.</p>
      </label>

      <label class="field">
        <div class="field-copy">
          <span class="field-title">Count track as played after (seconds)</span>
          <p class="field-hint">Only tracks that are in the library update their play count.</p>
        </div>
        <div class="field-control">
          <input
            type="number"
            min={MIN_PLAY_COUNT_THRESHOLD_SECONDS}
            max={MAX_PLAY_COUNT_THRESHOLD_SECONDS}
            step="1"
            value={$metadataSettings.playCountThresholdSeconds}
            on:change={handlePlayCountThresholdChange}
          />
        </div>
      </label>
    </div>
  </div>
</article>

