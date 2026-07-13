<script lang="ts">
  import { MAX_FOLDER_NESTING_LIMIT, MIN_FOLDER_NESTING_LIMIT, normalizeFolderNestingLimit, trackSettings } from '$lib/stores/track-settings';

  function handleFolderNestingLimitChange(event: Event) {
    trackSettings.update({ folderNestingLimit: normalizeFolderNestingLimit((event.currentTarget as HTMLInputElement).value) });
  }
  function handleVerifyAddedFilesToggle(event: Event) {
    trackSettings.update({ verifyAddedFiles: (event.currentTarget as HTMLInputElement).checked });
  }
</script>

<article class="view">
  <div class="section">
    <h2>Adding Tracks</h2>
    <div class="field-grid">
      <label class="field">
        <div class="field-copy">
          <span class="field-title">Folder nesting limit</span>
          <p class="field-hint">How many subfolder levels folder opens and folder drops traverse. Use 0 to read only files directly inside the selected folder.</p>
        </div>
        <div class="field-control">
          <input
            type="number"
            min={MIN_FOLDER_NESTING_LIMIT}
            max={MAX_FOLDER_NESTING_LIMIT}
            step="1"
            value={$trackSettings.folderNestingLimit}
            on:change={handleFolderNestingLimitChange}
          />
        </div>
      </label>

      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Verify added files</span>
        </div>
        <div class="field-control field-control-checkbox">
          <input
            type="checkbox"
            checked={$trackSettings.verifyAddedFiles}
            on:change={handleVerifyAddedFilesToggle}
          />
        </div>
        <p class="field-hint">Check unknown file extensions in a separate muted OpenMPT player before adding them. When disabled, izci adds any unknown file as a tracker module and lets normal playback report whether it works. Official OpenMPT extensions are accepted directly either way.</p>
      </label>
    </div>
  </div>
</article>

