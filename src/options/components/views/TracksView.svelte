<script lang="ts">
  import SettingsField from '../SettingsField.svelte';
  import { MAX_FOLDER_NESTING_LIMIT, MIN_FOLDER_NESTING_LIMIT, normalizeFolderNestingLimit, trackSettings } from '$lib/stores/track-settings';

  function handleFolderNestingLimitChange(event: Event) {
    trackSettings.update({ folderNestingLimit: normalizeFolderNestingLimit((event.currentTarget as HTMLInputElement).value) });
  }
  function handleVerifyAddedFilesToggle(event: Event) {
    trackSettings.update({ verifyAddedFiles: (event.currentTarget as HTMLInputElement).checked });
  }
  function handleAssociatedFileActionChange(event: Event) {
    const associatedFileAction = (event.currentTarget as HTMLSelectElement).value;

    if (associatedFileAction === 'add' || associatedFileAction === 'replace') {
      trackSettings.update({ associatedFileAction });
    }
  }
</script>

<article class="view">
  <div class="section">
    <h2>Adding Tracks</h2>
    <div class="field-grid">
      <SettingsField
        title="Folder nesting limit"
        hint="How many subfolder levels folder opens and folder drops traverse. Use 0 to read only files directly inside the selected folder."
      >
          <input
            type="number"
            min={MIN_FOLDER_NESTING_LIMIT}
            max={MAX_FOLDER_NESTING_LIMIT}
            step="1"
            value={$trackSettings.folderNestingLimit}
            on:change={handleFolderNestingLimitChange}
          />
      </SettingsField>

      <SettingsField
        title="Verify added files"
        hint="Check unknown file extensions in a separate muted OpenMPT player before adding them. When disabled, izci adds any unknown file as a tracker module and lets normal playback report whether it works. Official OpenMPT extensions are accepted directly either way."
        checkbox
      >
          <input
            type="checkbox"
            checked={$trackSettings.verifyAddedFiles}
            on:change={handleVerifyAddedFilesToggle}
          />
      </SettingsField>

      <SettingsField
        title="Files opened with izci"
        hint="Choose how files opened through operating-system file associations affect the current playlist."
      >
          <select value={$trackSettings.associatedFileAction} on:change={handleAssociatedFileActionChange}>
            <option value="add">Add to playlist</option>
            <option value="replace">Replace playlist</option>
          </select>
      </SettingsField>
    </div>
  </div>
</article>
