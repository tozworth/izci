<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import {
    normalizeTroubadourMetadataFields,
    troubadourSettings,
    type TroubadourSettings
  } from '$lib/stores/troubadour-settings';
  import type { TroubadourOptionsViewName } from './views';

  export let view: TroubadourOptionsViewName;

  type SettingKey = keyof TroubadourSettings;

  function updateValue(key: SettingKey, value: unknown): void {
    troubadourSettings.set({ ...troubadourSettings.getSnapshot(), [key]: value });
  }

  function updateSelect(key: SettingKey, event: Event): void {
    updateValue(key, (event.currentTarget as HTMLSelectElement).value);
  }

  function updateCheckbox(key: SettingKey, event: Event): void {
    updateValue(key, (event.currentTarget as HTMLInputElement).checked);
  }

  function updateNumber(key: SettingKey, event: Event): void {
    updateValue(key, (event.currentTarget as HTMLInputElement).value);
  }

  function updateText(key: SettingKey, event: Event): void {
    updateValue(key, (event.currentTarget as HTMLInputElement).value);
  }

  function updatePaneLayout(key: keyof TroubadourSettings['paneLayout'], event: Event): void {
    troubadourSettings.set({
      ...troubadourSettings.getSnapshot(),
      paneLayout: {
        ...troubadourSettings.getSnapshot().paneLayout,
        [key]: (event.currentTarget as HTMLInputElement).value
      }
    });
  }

  function updateMetadataFields(event: Event): void {
    const fields = (event.currentTarget as HTMLInputElement).value
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    updateValue('visibleMetadataFields', normalizeTroubadourMetadataFields(fields));
  }
</script>

<article class="view troubadour-options-page">
  {#if view === 'general'}
    <div class="section">
      <h2>{$t('troubadour.options.general.loading', { default: 'Loading and grouping' })}</h2>
      <div class="field-grid">
        <SettingsField title={$t('troubadour.options.general.initialLoad', { default: 'Initial load behavior' })} hint={$t('troubadour.options.general.initialLoadHint', { default: 'Choose which izci tracks enter a newly opened transient workbench.' })}>
          <select value={$troubadourSettings.initialLoad} on:change={(event) => updateSelect('initialLoad', event)}>
            <option value="current-selection">{$t('troubadour.options.general.currentSelection', { default: 'Current selection' })}</option>
            <option value="current-track">{$t('troubadour.options.general.currentTrack', { default: 'Current track' })}</option>
            <option value="nothing">{$t('troubadour.options.general.nothing', { default: 'Nothing' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.general.scanDepth', { default: 'Folder scan depth' })} hint={$t('troubadour.options.general.scanDepthHint', { default: 'Maximum number of subfolder levels. Use 0 for only the chosen folder.' })}>
          <input type="number" min="0" max="64" value={$troubadourSettings.folderScanDepth} on:change={(event) => updateNumber('folderScanDepth', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.general.readConcurrency', { default: 'Metadata-read concurrency' })} hint={$t('troubadour.options.general.readConcurrencyHint', { default: 'Bounds parallel background reads; file writes use a separate safety limit.' })}>
          <input type="number" min="1" max="12" value={$troubadourSettings.metadataReadConcurrency} on:change={(event) => updateNumber('metadataReadConcurrency', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.general.autoGroup', { default: 'Auto-group after loading' })} checkbox>
          <input type="checkbox" checked={$troubadourSettings.autoGroupOnLoad} on:change={(event) => updateCheckbox('autoGroupOnLoad', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.general.groupFallback', { default: 'Auto-group fallback' })} hint={$t('troubadour.options.general.groupFallbackHint', { default: 'Album tags are always tried first.' })}>
          <select value={$troubadourSettings.autoGroupFallback} on:change={(event) => updateSelect('autoGroupFallback', event)}>
            <option value="folder">{$t('troubadour.options.general.folderFallback', { default: 'Containing folder' })}</option>
            <option value="none">{$t('troubadour.options.general.noFallback', { default: 'No fallback' })}</option>
          </select>
        </SettingsField>
      </div>
    </div>

    <div class="section">
      <h2>{$t('troubadour.options.general.workspace', { default: 'Workspace' })}</h2>
      <div class="field-grid">
        <SettingsField title={$t('troubadour.options.general.rawPane', { default: 'Raw-files pane width (%)' })}>
          <input type="number" min="20" max="80" value={$troubadourSettings.paneLayout.rawFilesPercent} on:change={(event) => updatePaneLayout('rawFilesPercent', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.general.inspectorPane', { default: 'Inspector height (%)' })}>
          <input type="number" min="20" max="70" value={$troubadourSettings.paneLayout.inspectorPercent} on:change={(event) => updatePaneLayout('inspectorPercent', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.general.artworkPane', { default: 'Artwork pane width (%)' })}>
          <input type="number" min="18" max="55" value={$troubadourSettings.paneLayout.artworkPercent} on:change={(event) => updatePaneLayout('artworkPercent', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.general.lastTab', { default: 'Last active tab' })}>
          <select value={$troubadourSettings.lastActiveTab} on:change={(event) => updateSelect('lastActiveTab', event)}>
            <option value="metadata">{$t('troubadour.options.metadata.label', { default: 'Metadata' })}</option>
            <option value="rename">{$t('troubadour.options.rename.label', { default: 'Rename' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.general.confirmDirtyRemoval', { default: 'Confirm removing dirty items' })} hint={$t('troubadour.options.general.confirmDirtyRemovalHint', { default: 'Removal only discards staged work; it never deletes source files.' })} checkbox>
          <input type="checkbox" checked={$troubadourSettings.confirmDirtyRemoval} on:change={(event) => updateCheckbox('confirmDirtyRemoval', event)} />
        </SettingsField>
      </div>
    </div>
  {:else if view === 'metadata'}
    <div class="section">
      <h2>{$t('troubadour.options.metadata.rows', { default: 'Property grid' })}</h2>
      <div class="field-grid">
        <SettingsField title={$t('troubadour.options.metadata.visibleFields', { default: 'Visible fields and order' })} hint={$t('troubadour.options.metadata.visibleFieldsHint', { default: 'Comma-separated field IDs. Unknown and duplicate IDs are ignored.' })}>
          <input class="wide-text-input" type="text" value={$troubadourSettings.visibleMetadataFields.join(', ')} on:change={updateMetadataFields} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.metadata.multiValues', { default: 'Multi-value display' })}>
          <select value={$troubadourSettings.multiValueDisplay} on:change={(event) => updateSelect('multiValueDisplay', event)}>
            <option value="joined">{$t('troubadour.options.metadata.joined', { default: 'Join values' })}</option>
            <option value="first">{$t('troubadour.options.metadata.first', { default: 'First value' })}</option>
            <option value="count">{$t('troubadour.options.metadata.count', { default: 'Value count' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.metadata.dateDisplay', { default: 'Date display' })}>
          <select value={$troubadourSettings.dateDisplay} on:change={(event) => updateSelect('dateDisplay', event)}>
            <option value="verbatim">{$t('troubadour.options.metadata.verbatim', { default: 'Stored value' })}</option>
            <option value="year">{$t('troubadour.options.metadata.yearOnly', { default: 'Year only' })}</option>
            <option value="localized">{$t('troubadour.options.metadata.localized', { default: 'Localized date' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.metadata.albumPolicy', { default: 'Album edit application' })}>
          <select value={$troubadourSettings.albumEditPolicy} on:change={(event) => updateSelect('albumEditPolicy', event)}>
            <option value="ask">{$t('troubadour.options.common.ask', { default: 'Ask' })}</option>
            <option value="all-writable">{$t('troubadour.options.metadata.allWritable', { default: 'All writable tracks' })}</option>
            <option value="supported-only">{$t('troubadour.options.metadata.supportedOnly', { default: 'Supported selected tracks only' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.metadata.renumber', { default: 'After manual reorder' })} hint={$t('troubadour.options.metadata.renumberHint', { default: 'Manual ordering and track-number edits remain separate operations.' })}>
          <select value={$troubadourSettings.reorderRenumber} on:change={(event) => updateSelect('reorderRenumber', event)}>
            <option value="offer">{$t('troubadour.options.metadata.offerRenumber', { default: 'Offer to renumber' })}</option>
            <option value="never">{$t('troubadour.options.metadata.neverRenumber', { default: 'Never renumber' })}</option>
            <option value="always">{$t('troubadour.options.metadata.alwaysRenumber', { default: 'Renumber automatically' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.metadata.rawTags', { default: 'Raw-tag visibility' })} advanced>
          <select value={$troubadourSettings.rawTagVisibility} on:change={(event) => updateSelect('rawTagVisibility', event)}>
            <option value="advanced">{$t('troubadour.options.metadata.rawAdvanced', { default: 'Advanced inspector' })}</option>
            <option value="always">{$t('troubadour.options.common.always', { default: 'Always' })}</option>
            <option value="hidden">{$t('troubadour.options.common.hidden', { default: 'Hidden' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.metadata.validation', { default: 'Validation indicators' })} advanced>
          <select value={$troubadourSettings.validationSeverity} on:change={(event) => updateSelect('validationSeverity', event)}>
            <option value="warnings">{$t('troubadour.options.metadata.warnings', { default: 'Warnings and errors' })}</option>
            <option value="errors">{$t('troubadour.options.metadata.errors', { default: 'Errors only' })}</option>
            <option value="all">{$t('troubadour.options.metadata.allChecks', { default: 'All checks' })}</option>
          </select>
        </SettingsField>
      </div>
      <p class="options-page-note">{$t('troubadour.options.metadata.preservation', { default: 'Unknown tags are always preserved. This safety rule is not configurable.' })}</p>
    </div>
  {:else if view === 'artwork'}
    <div class="section">
      <h2>{$t('troubadour.options.artwork.defaults', { default: 'Artwork defaults' })}</h2>
      <div class="field-grid">
        <SettingsField title={$t('troubadour.options.artwork.kind', { default: 'New artwork kind' })}>
          <select value={$troubadourSettings.defaultArtworkKind} on:change={(event) => updateSelect('defaultArtworkKind', event)}>
            <option value="front">{$t('troubadour.options.artwork.front', { default: 'Front cover' })}</option>
            <option value="back">{$t('troubadour.options.artwork.back', { default: 'Back cover' })}</option>
            <option value="other">{$t('troubadour.options.artwork.other', { default: 'Other / unknown' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.artwork.sizeWarning', { default: 'Size warning (MB)' })} hint={$t('troubadour.options.artwork.warningHint', { default: 'Warnings never resize or recompress artwork automatically.' })}>
          <input type="number" min="1" max="256" value={$troubadourSettings.artworkSizeWarningMb} on:change={(event) => updateNumber('artworkSizeWarningMb', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.artwork.dimensionWarning', { default: 'Dimension warning (pixels)' })}>
          <input type="number" min="256" max="32768" value={$troubadourSettings.artworkDimensionWarningPx} on:change={(event) => updateNumber('artworkDimensionWarningPx', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.artwork.multiple', { default: 'Multiple-image behavior' })}>
          <select value={$troubadourSettings.multipleImageBehavior} on:change={(event) => updateSelect('multipleImageBehavior', event)}>
            <option value="preserve">{$t('troubadour.options.artwork.preserve', { default: 'Preserve all untouched images' })}</option>
            <option value="replace-kind">{$t('troubadour.options.artwork.replaceKind', { default: 'Replace the same kind' })}</option>
            <option value="reject">{$t('troubadour.options.artwork.rejectMultiple', { default: 'Reject another image' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.artwork.albumApply', { default: 'Album artwork application' })}>
          <select value={$troubadourSettings.albumArtworkDefault} on:change={(event) => updateSelect('albumArtworkDefault', event)}>
            <option value="ask">{$t('troubadour.options.common.ask', { default: 'Ask' })}</option>
            <option value="selected">{$t('troubadour.options.artwork.selectedTracks', { default: 'Selected tracks' })}</option>
            <option value="album">{$t('troubadour.options.artwork.allAlbumTracks', { default: 'All album tracks' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.artwork.previewFit', { default: 'Preview presentation' })}>
          <select value={$troubadourSettings.artworkPreviewFit} on:change={(event) => updateSelect('artworkPreviewFit', event)}>
            <option value="contain">{$t('troubadour.options.artwork.fit', { default: 'Fit entire image' })}</option>
            <option value="cover">{$t('troubadour.options.artwork.fill', { default: 'Fill preview' })}</option>
            <option value="actual">{$t('troubadour.options.artwork.actual', { default: 'Actual size' })}</option>
          </select>
        </SettingsField>
      </div>
    </div>
  {:else if view === 'rename'}
    <div class="section">
      <h2>{$t('troubadour.options.rename.defaults', { default: 'Rename defaults' })}</h2>
      <div class="field-grid">
        <SettingsField title={$t('troubadour.options.rename.template', { default: 'Default template' })} hint={$t('troubadour.options.rename.templateHint', { default: 'Renames are previewed and validated before any file operation.' })}>
          <input class="wide-text-input" type="text" value={$troubadourSettings.renameTemplate} on:change={(event) => updateText('renameTemplate', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.rename.replacement', { default: 'Illegal-character replacement' })}>
          <input class="compact-text-input" type="text" maxlength="1" value={$troubadourSettings.illegalCharacterReplacement} on:change={(event) => updateText('illegalCharacterReplacement', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.rename.whitespace', { default: 'Normalize whitespace' })} checkbox>
          <input type="checkbox" checked={$troubadourSettings.normalizeWhitespace} on:change={(event) => updateCheckbox('normalizeWhitespace', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.rename.unicode', { default: 'Unicode handling' })}>
          <select value={$troubadourSettings.unicodeNormalization} on:change={(event) => updateSelect('unicodeNormalization', event)}>
            <option value="preserve">{$t('troubadour.options.rename.preserveUnicode', { default: 'Preserve' })}</option>
            <option value="nfc">NFC</option>
            <option value="ascii">{$t('troubadour.options.rename.ascii', { default: 'ASCII approximation' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.rename.extensionCase', { default: 'Extension case' })}>
          <select value={$troubadourSettings.extensionCase} on:change={(event) => updateSelect('extensionCase', event)}>
            <option value="preserve">{$t('troubadour.options.common.preserve', { default: 'Preserve' })}</option>
            <option value="lower">{$t('troubadour.options.rename.lower', { default: 'Lowercase' })}</option>
            <option value="upper">{$t('troubadour.options.rename.upper', { default: 'Uppercase' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.rename.missingTokens', { default: 'Missing-token policy' })} advanced>
          <select value={$troubadourSettings.missingTokenPolicy} on:change={(event) => updateSelect('missingTokenPolicy', event)}>
            <option value="stop">{$t('troubadour.options.rename.stopPreview', { default: 'Block preview' })}</option>
            <option value="empty">{$t('troubadour.options.rename.emptyValue', { default: 'Use an empty value' })}</option>
            <option value="skip">{$t('troubadour.options.rename.skipFile', { default: 'Skip file' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.rename.collisions', { default: 'Collision policy' })} advanced>
          <select value={$troubadourSettings.collisionPolicy} on:change={(event) => updateSelect('collisionPolicy', event)}>
            <option value="stop">{$t('troubadour.options.rename.stopCorrection', { default: 'Stop for correction' })}</option>
            <option value="skip">{$t('troubadour.options.rename.skipCollision', { default: 'Skip colliding files' })}</option>
            <option value="counter">{$t('troubadour.options.rename.counter', { default: 'Add a counter' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.rename.folderTemplates', { default: 'Enable folder templates when supported' })} hint={$t('troubadour.options.rename.folderTemplatesHint', { default: 'Only available when Troubadour has writable handles for every required parent directory.' })} advanced checkbox>
          <input type="checkbox" checked={$troubadourSettings.enableFolderTemplates} on:change={(event) => updateCheckbox('enableFolderTemplates', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.rename.copyVerification', { default: 'Copy fallback verification' })} advanced>
          <select value={$troubadourSettings.copyVerification} on:change={(event) => updateSelect('copyVerification', event)}>
            <option value="metadata">{$t('troubadour.options.rename.verifyMetadata', { default: 'Size and metadata' })}</option>
            <option value="size">{$t('troubadour.options.rename.verifySize', { default: 'Size only' })}</option>
            <option value="hash">{$t('troubadour.options.rename.verifyHash', { default: 'Full content hash' })}</option>
          </select>
        </SettingsField>
      </div>
      <p class="options-page-note">{$t('troubadour.options.rename.noOverwrite', { default: 'Troubadour never silently overwrites an unrelated destination.' })}</p>
    </div>
  {:else if view === 'files'}
    <div class="section">
      <h2>{$t('troubadour.options.files.writes', { default: 'Writes and recovery' })}</h2>
      <div class="field-grid">
        <SettingsField title={$t('troubadour.options.files.backup', { default: 'Backup policy' })} hint={$t('troubadour.options.files.backupHint', { default: 'The normal workflow writes verified changes in place. Backups are optional.' })}>
          <select value={$troubadourSettings.backupPolicy} on:change={(event) => updateSelect('backupPolicy', event)}>
            <option value="none">{$t('troubadour.options.files.noBackup', { default: 'No backup' })}</option>
            <option value="sibling">{$t('troubadour.options.files.siblingBackup', { default: 'Sibling backup' })}</option>
            <option value="backup-folder">{$t('troubadour.options.files.backupFolder', { default: 'Backup folder' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.files.verification', { default: 'Post-write verification' })}>
          <select value={$troubadourSettings.postWriteVerification} on:change={(event) => updateSelect('postWriteVerification', event)}>
            <option value="managed-fields">{$t('troubadour.options.files.managedFields', { default: 'Managed fields and artwork' })}</option>
            <option value="full-metadata">{$t('troubadour.options.files.fullMetadata', { default: 'Full metadata snapshot' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.files.concurrency', { default: 'Write concurrency' })} hint={$t('troubadour.options.files.concurrencyHint', { default: 'Writes remain sequential by default. Files in one directory are never raced.' })} advanced>
          <input type="number" min="1" max="4" value={$troubadourSettings.writeConcurrency} on:change={(event) => updateNumber('writeConcurrency', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.files.externalChanges', { default: 'External-change behavior' })} advanced>
          <select value={$troubadourSettings.externalChangeBehavior} on:change={(event) => updateSelect('externalChangeBehavior', event)}>
            <option value="stop">{$t('troubadour.options.files.stopConflict', { default: 'Stop with a conflict' })}</option>
            <option value="reload-unchanged">{$t('troubadour.options.files.reloadClean', { default: 'Reload unchanged items' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.files.batchError', { default: 'After a batch error' })}>
          <select value={$troubadourSettings.batchErrorBehavior} on:change={(event) => updateSelect('batchErrorBehavior', event)}>
            <option value="continue">{$t('troubadour.options.files.continue', { default: 'Continue with remaining files' })}</option>
            <option value="stop">{$t('troubadour.options.files.stop', { default: 'Stop the batch' })}</option>
          </select>
        </SettingsField>
        <SettingsField title={$t('troubadour.options.files.clearThreshold', { default: 'Confirm destructive clears at (files)' })} hint={$t('troubadour.options.files.clearThresholdHint', { default: 'Applies to bulk metadata and artwork clears, not ordinary field edits.' })} advanced>
          <input type="number" min="1" max="1000" value={$troubadourSettings.destructiveClearConfirmationThreshold} on:change={(event) => updateNumber('destructiveClearConfirmationThreshold', event)} />
        </SettingsField>
      </div>
    </div>
  {:else}
    <div class="section">
      <h2>{$t('troubadour.options.advanced.processing', { default: 'Processing' })}</h2>
      <div class="field-grid">
        <SettingsField title={$t('troubadour.options.advanced.largeFile', { default: 'Large-file threshold (MB)' })} hint={$t('troubadour.options.advanced.largeFileHint', { default: 'Shows additional progress and memory-use warnings; it does not block the file.' })} advanced>
          <input type="number" min="64" max="16384" value={$troubadourSettings.largeFileThresholdMb} on:change={(event) => updateNumber('largeFileThresholdMb', event)} />
        </SettingsField>
        <SettingsField title={$t('troubadour.options.advanced.diagnostics', { default: 'Diagnostic job reporting' })} hint={$t('troubadour.options.advanced.diagnosticsHint', { default: 'Retains detailed results in the transient workbench until it closes.' })} advanced checkbox>
          <input type="checkbox" checked={$troubadourSettings.diagnosticJobReporting} on:change={(event) => updateCheckbox('diagnosticJobReporting', event)} />
        </SettingsField>
      </div>
    </div>

    <div class="section">
      <h2>{$t('troubadour.options.advanced.capabilities', { default: 'Capabilities' })}</h2>
      <dl class="capability-list">
        <div><dt>{$t('troubadour.options.advanced.writable', { default: 'Writable metadata' })}</dt><dd>MP3, FLAC, Ogg Vorbis, Ogg Opus, WAV</dd></div>
        <div><dt>{$t('troubadour.options.advanced.offline', { default: 'Network providers' })}</dt><dd>{$t('troubadour.options.advanced.offlineValue', { default: 'Offline only — MusicBrainz is not enabled' })}</dd></div>
        <div><dt>{$t('troubadour.options.advanced.transient', { default: 'Workbench storage' })}</dt><dd>{$t('troubadour.options.advanced.transientValue', { default: 'Transient; files and staged edits are not persisted' })}</dd></div>
      </dl>
      <button class="options-action-button danger-action" type="button" on:click={() => troubadourSettings.reset()}>
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
        {$t('troubadour.options.advanced.resetAll', { default: 'Reset all Troubadour settings' })}
      </button>
    </div>
  {/if}
</article>
