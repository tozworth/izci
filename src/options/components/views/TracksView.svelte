<script lang="ts">
  import { t } from 'svelte-i18n';
  import { DesktopTrackSettings } from '$platform';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import ThemedSelect from '$lib/components/options/ThemedSelect.svelte';
  import { MAX_FOLDER_NESTING_LIMIT, MIN_FOLDER_NESTING_LIMIT, normalizeFolderNestingLimit, trackSettings } from '$lib/stores/track-settings';

  function handleFolderNestingLimitChange(event: Event) {
    trackSettings.update({ folderNestingLimit: normalizeFolderNestingLimit((event.currentTarget as HTMLInputElement).value) });
  }
  function handleVerifyAddedFilesToggle(event: Event) {
    trackSettings.update({ verifyAddedFiles: (event.currentTarget as HTMLInputElement).checked });
  }
  function handleQueueDeduplicationToggle(event: Event) {
    trackSettings.update({ deduplicateQueue: (event.currentTarget as HTMLInputElement).checked });
  }
  function handleAssociatedFileActionChange(event: CustomEvent<string>) {
    const associatedFileAction = event.detail;

    if (associatedFileAction === 'add' || associatedFileAction === 'replace') {
      trackSettings.update({ associatedFileAction });
    }
  }
  function handleFavoriteToggleVisibility(event: Event) {
    trackSettings.update({
      showFavoriteToggleInPlayerBar: (event.currentTarget as HTMLInputElement).checked
    });
  }
  function handleRatingsToggle(event: Event) {
    trackSettings.update({
      enableRatings: (event.currentTarget as HTMLInputElement).checked
    });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.tracks.adding.heading', { default: 'Adding Tracks' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.tracks.folderNesting.title', { default: 'Folder nesting limit' })}
        hint={$t('options.tracks.folderNesting.hint', { default: 'How many subfolder levels folder opens and folder drops traverse. Use 0 to read only files directly inside the selected folder.' })}
        advanced
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
        title={$t('options.tracks.verify.title', { default: 'Verify added files' })}
        hint={$t('options.tracks.verify.hint', { default: 'Check unknown file extensions in a separate muted OpenMPT player before adding them. When disabled, izci adds any unknown file as a tracker module and lets normal playback report whether it works. Official OpenMPT extensions are accepted directly either way.' })}
        advanced
        checkbox
      >
          <input
            type="checkbox"
            checked={$trackSettings.verifyAddedFiles}
            on:change={handleVerifyAddedFilesToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.tracks.deduplicateQueue.title', { default: 'Deduplicate queue additions' })}
        hint={$t('options.tracks.deduplicateQueue.hint', { default: 'Skip tracks already in the queue and repeated tracks within the same addition.' })}
        advanced
        checkbox
      >
          <input
            type="checkbox"
            checked={$trackSettings.deduplicateQueue}
            on:change={handleQueueDeduplicationToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.tracks.associatedFiles.title', { default: 'Files opened with izci' })}
        hint={$t('options.tracks.associatedFiles.hint', { default: 'Choose how files opened through operating-system file associations affect the current queue.' })}
      >
          <ThemedSelect
            value={$trackSettings.associatedFileAction}
            options={[
              { value: 'add', label: $t('options.tracks.associatedFiles.add', { default: 'Add to queue' }) },
              { value: 'replace', label: $t('options.tracks.associatedFiles.replace', { default: 'Replace queue' }) }
            ]}
            label={$t('options.tracks.associatedFiles.title', { default: 'Files opened with izci' })}
            on:change={handleAssociatedFileActionChange}
          />
      </SettingsField>
      {#if DesktopTrackSettings}
        <svelte:component this={DesktopTrackSettings} />
      {/if}
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.tracks.playerBar.heading', { default: 'Player Bar' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.tracks.favoriteToggle.title', { default: 'Show favorite toggle' })}
        hint={$t('options.tracks.favoriteToggle.hint', { default: 'Show a heart button after the transport controls for adding or removing the current track or module subsong from Favorites.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$trackSettings.showFavoriteToggleInPlayerBar}
          on:change={handleFavoriteToggleVisibility}
        />
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.tracks.ratings.heading', { default: 'Ratings' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.tracks.ratings.title', { default: 'Enable track ratings' })}
        hint={$t('options.tracks.ratings.hint', { default: 'Show half-star rating controls and the Rating library column. Turning this off hides ratings without deleting them.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$trackSettings.enableRatings}
          on:change={handleRatingsToggle}
        />
      </SettingsField>
    </div>
  </div>
</article>
