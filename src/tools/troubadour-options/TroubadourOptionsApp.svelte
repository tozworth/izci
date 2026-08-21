<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import OptionsView, { type SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';
  import {
    DEFAULT_TROUBADOUR_SETTINGS,
    troubadourSettings,
    type TroubadourSettings
  } from '$lib/stores/troubadour-settings';
  import TroubadourSettingsPage from './TroubadourSettingsPage.svelte';
  import {
    TROUBADOUR_OPTIONS_VIEW_GROUPS,
    buildTroubadourOptionsPath,
    getTroubadourOptionsViewFromLocation,
    isTroubadourOptionsViewName,
    type TroubadourOptionsViewName
  } from './views';
  import {
    getTroubadourOptionsWindowState,
    rememberTroubadourOptionsActiveView,
    rememberTroubadourOptionsAdvancedVisibility
  } from './window-state';

  const PAGE_KEYS: Record<TroubadourOptionsViewName, (keyof TroubadourSettings)[]> = {
    general: [
      'initialLoad', 'folderScanDepth', 'metadataReadConcurrency', 'autoGroupOnLoad',
      'autoGroupFallback', 'confirmDirtyRemoval'
    ],
    metadata: [
      'visibleMetadataFields', 'dateDisplay', 'rawTagVisibility', 'validationSeverity'
    ],
    artwork: [
      'defaultArtworkKind', 'artworkSizeWarningMb', 'artworkDimensionWarningPx',
      'multipleImageBehavior', 'albumArtworkDefault', 'artworkPreviewFit'
    ],
    rename: [
      'renameTemplate', 'illegalCharacterReplacement', 'normalizeWhitespace',
      'unicodeNormalization', 'extensionCase', 'missingTokenPolicy', 'collisionPolicy',
      'copyVerification'
    ],
    files: [
      'backupPolicy', 'postWriteVerification', 'externalChangeBehavior',
      'batchErrorBehavior', 'destructiveClearConfirmationThreshold', 'diagnosticJobReporting'
    ]
  };

  const initialWindowState = getTroubadourOptionsWindowState();
  let activeView: TroubadourOptionsViewName = window.location.search
    ? getTroubadourOptionsViewFromLocation(window.location)
    : initialWindowState.activeView;
  let showAdvancedTweaks = initialWindowState.showAdvancedTweaks;
  let advancedTweaksModified = false;

  function viewLabel(view: TroubadourOptionsViewName): string {
    switch (view) {
      case 'general': return $t('troubadour.options.general.label', { default: 'General' });
      case 'metadata': return $t('troubadour.options.metadata.label', { default: 'Metadata' });
      case 'artwork': return $t('troubadour.options.artwork.label', { default: 'Artwork' });
      case 'rename': return $t('troubadour.options.rename.label', { default: 'Rename' });
      case 'files': return $t('troubadour.options.files.label', { default: 'Files and safety' });
    }
  }

  function setActiveView(view: TroubadourOptionsViewName): void {
    activeView = view;
    rememberTroubadourOptionsActiveView(view);
    const path = buildTroubadourOptionsPath(view);
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.replaceState(null, '', path);
    }
  }

  function resetCurrentPage(): void {
    const patch: Partial<TroubadourSettings> = {};
    for (const key of PAGE_KEYS[activeView]) {
      (patch as Record<keyof TroubadourSettings, unknown>)[key] = DEFAULT_TROUBADOUR_SETTINGS[key];
    }
    troubadourSettings.update(patch);
  }

  function pageHasModifiedAdvancedSettings(view: TroubadourOptionsViewName, settings: TroubadourSettings): boolean {
    const keys: Partial<Record<TroubadourOptionsViewName, (keyof TroubadourSettings)[]>> = {
      metadata: ['rawTagVisibility', 'validationSeverity'],
      rename: ['missingTokenPolicy', 'collisionPolicy', 'copyVerification'],
      files: ['postWriteVerification', 'externalChangeBehavior', 'destructiveClearConfirmationThreshold', 'diagnosticJobReporting']
    };
    return (keys[view] ?? []).some((key) => JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_TROUBADOUR_SETTINGS[key]));
  }

  onMount(() => {
    rememberTroubadourOptionsActiveView(activeView);
    const syncFromLocation = () => setActiveView(getTroubadourOptionsViewFromLocation(window.location));
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === 'izci:open-troubadour-options-view' &&
        isTroubadourOptionsViewName(event.data.view)
      ) {
        setActiveView(event.data.view);
      }
    };

    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('message', handleMessage);
    };
  });

  $: sharedViewGroups = TROUBADOUR_OPTIONS_VIEW_GROUPS.map((group) => group.map((view): SharedOptionsViewDefinition => ({
    ...view,
    label: viewLabel(view.id as TroubadourOptionsViewName)
  })));
  $: advancedTweaksModified = pageHasModifiedAdvancedSettings(activeView, $troubadourSettings);
</script>

<OptionsView
  windowTitle={$t('troubadour.options.windowTitle', { default: 'izci Troubadour Options' })}
  pageToolsLabel={$t('options.tools.label', { default: 'Page tools' })}
  categoriesLabel={$t('troubadour.options.categories', { default: 'Troubadour options categories' })}
  groups={sharedViewGroups}
  activeView={activeView}
  bind:showAdvancedTweaks
  advancedTweaksModified={advancedTweaksModified}
  expandHintsLabel={$t('options.tools.expandHints', { default: 'Expand field hints' })}
  collapseHintsLabel={$t('options.tools.collapseHints', { default: 'Collapse field hints' })}
  showAdvancedTweaksLabel={$t('options.tools.showAdvancedTweaks', { default: 'Show advanced tweaks' })}
  showModifiedAdvancedTweaksLabel={$t('options.tools.showAdvancedTweaksModified', { default: 'Show advanced tweaks — some differ from defaults' })}
  hideAdvancedTweaksLabel={$t('options.tools.hideAdvancedTweaks', { default: 'Hide advanced tweaks' })}
  resetPageLabel={$t('options.tools.resetPage', { default: 'Reset current page to defaults' })}
  on:select={(event) => setActiveView(event.detail.view as TroubadourOptionsViewName)}
  on:reset={resetCurrentPage}
  on:advancedvisibilitychange={(event) => rememberTroubadourOptionsAdvancedVisibility(event.detail.visible)}
>
  <TroubadourSettingsPage view={activeView} />
</OptionsView>
