<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import OptionsView, { type SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';
  import OptionsContent from './OptionsContent.svelte';
  import MobileOptionsView from '../mobile/MobileOptionsView.svelte';
  import { isMobileNavigator } from '../mobile/mobile-device';
  import {
    getOptionsWindowState,
    rememberOptionsActiveView,
    rememberShowAdvancedTweaks
  } from '$lib/services/options-window-state';
  import { appearanceSettings, DEFAULT_APPEARANCE_SETTINGS } from '$lib/stores/appearance-settings';
  import { DEFAULT_METADATA_SETTINGS, metadataSettings } from '$lib/stores/metadata-settings';
  import { DEFAULT_MULTIPLAYER_SETTINGS, multiplayerSettings } from '$lib/stores/multiplayer-settings';
  import { DEFAULT_PLAYBACK_SETTINGS, playbackSettings } from '$lib/stores/playback-settings';
  import { DEFAULT_PATTERN_VIEWER_SETTINGS, patternViewerSettings } from '$lib/stores/pattern-viewer-settings';
  import { DEFAULT_ODA_SETTINGS, odaSettings } from '$lib/stores/oda-settings';
  import { DEFAULT_TRACK_SETTINGS, trackSettings } from '$lib/stores/track-settings';
  import { DEFAULT_VISUALIZER_SETTINGS, visualizerSettings } from '$lib/stores/visualizer-settings';
  import { resetOptionsView } from './options-reset';
  import {
    OPTIONS_VIEW_GROUPS,
    OPTIONS_VIEWS,
    buildOptionsWindowPath,
    getOptionsViewFromLocation,
    isOptionsViewName,
    type OptionsViewName
  } from './views';

  export let embedded = false;
  export let initialView: OptionsViewName | undefined = undefined;

  const dispatch = createEventDispatcher<{ close: void }>();

  const initialOptionsWindowState = getOptionsWindowState();
  const mobileMode = isMobileNavigator(typeof navigator === 'undefined' ? null : navigator);
  const requestedView = getOptionsViewFromLocation(window.location);
  let activeView: OptionsViewName = initialView ?? (embedded
    ? initialOptionsWindowState.activeView
    : window.location.search
      ? requestedView
      : initialOptionsWindowState.activeView);
  if (activeView === 'raf' && !playbackSettings.getSnapshot().enableRaf) {
    activeView = 'playback';
  }
  let showAdvancedTweaks = initialOptionsWindowState.showAdvancedTweaks;
  let advancedTweaksModified = false;

  function viewLabel(view: OptionsViewName): string {
    switch (view) {
      case 'appearance': return $t('options.views.appearance', { default: 'Appearance' });
      case 'backdrops': return $t('options.views.backdrops', { default: 'Backdrops' });
      case 'now-playing': return $t('options.views.nowPlaying', { default: 'Now Playing' });
      case 'lyrics': return $t('options.views.lyrics', { default: 'Lyrics' });
      case 'playback': return $t('options.views.playback', { default: 'Playback' });
      case 'oda': return $t('options.views.oda', { default: 'Oda' });
      case 'video': return $t('options.views.video', { default: 'Video' });
      case 'raf': return $t('options.views.raf', { default: 'Raf' });
      case 'visualizer': return $t('options.views.visualizer', { default: 'Visualizer' });
      case 'patterns': return $t('options.views.patterns', { default: 'Patterns' });
      case 'modules': return $t('options.views.modules', { default: 'Modules' });
      case 'loadouts': return $t('options.views.loadouts', { default: 'Loadouts' });
      case 'tracks': return $t('options.views.tracks', { default: 'Tracks' });
      case 'folders': return $t('options.views.folders', { default: 'Folders' });
      case 'metadata': return $t('options.views.metadata', { default: 'Metadata' });
      case 'backups': return $t('options.views.backups', { default: 'Backups' });
      case 'multiplayer': return $t('options.views.multiplayer', { default: 'Multiplayer' });
      case 'hosting': return $t('options.views.hosting', { default: 'Hosting' });
      case 'experimental': return $t('options.views.experimental', { default: 'Experimental' });
      case 'cache': return $t('options.views.cache', { default: 'Cache' });
      case 'about': return $t('options.views.about', { default: 'About' });
      case 'licenses': return $t('options.views.licenses', { default: 'Licenses' });
    }
  }

  function parentViewId(view: OptionsViewName): OptionsViewName | null {
    if (view === 'backdrops' || view === 'now-playing' || view === 'visualizer' || view === 'patterns' || view === 'lyrics') return 'appearance';
    if (view === 'video' || view === 'raf' || view === 'modules') return 'playback';
    if (view === 'folders' || view === 'metadata') return 'tracks';
    if (view === 'hosting' || view === 'cache') return 'multiplayer';
    if (view === 'licenses') return 'about';
    return null;
  }

  function desktopTreeGroups(groups: SharedOptionsViewDefinition[][]): SharedOptionsViewDefinition[][] {
    const odaView = groups.flat().find((view) => view.id === 'oda');
    return groups.map((group) => group
      .filter((view) => view.id !== 'oda')
      .flatMap((view) => view.id === 'playback' && odaView
        ? [{ ...odaView, parentId: 'appearance' }, view]
        : [view])
    ).filter((group) => group.length > 0);
  }

  function setActiveView(view: OptionsViewName) {
    if (view === 'raf' && !playbackSettings.getSnapshot().enableRaf) {
      view = 'playback';
    }
    activeView = view;
    rememberOptionsActiveView(view);

    if (!embedded) {
      const nextUrl = buildOptionsWindowPath(view);
      if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
        window.history.replaceState(null, '', nextUrl);
      }
    }
  }

  function resetCurrentView() {
    resetOptionsView(activeView);
  }

  onMount(() => {
    rememberOptionsActiveView(activeView);
    if (embedded) {
      return;
    }

    const syncActiveViewFromLocation = () => setActiveView(getOptionsViewFromLocation(window.location));
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === 'izci:open-options-view' &&
        isOptionsViewName(event.data.view)
      ) {
        setActiveView(event.data.view);
      }
    };

    window.addEventListener('popstate', syncActiveViewFromLocation);
    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('popstate', syncActiveViewFromLocation);
      window.removeEventListener('message', handleMessage);
    };
  });

  $: if (activeView === 'raf' && !$playbackSettings.enableRaf) {
    setActiveView('playback');
  }
  $: sharedViewGroups = OPTIONS_VIEW_GROUPS.map((group) => group.map((view): SharedOptionsViewDefinition => ({
    ...view,
    label: viewLabel(view.id),
    parentId: parentViewId(view.id),
    hidden: view.id === 'raf' && !$playbackSettings.enableRaf
  })));
  $: desktopViewGroups = desktopTreeGroups(sharedViewGroups);
  $: auxiliaryViews = [{
    ...OPTIONS_VIEWS.licenses,
    label: viewLabel('licenses'),
    parentId: 'about'
  } satisfies SharedOptionsViewDefinition];
  $: {
    switch (activeView) {
      case 'appearance':
        advancedTweaksModified =
          $appearanceSettings.keepLibraryColumnsVisibleInNarrowLayout !== DEFAULT_APPEARANCE_SETTINGS.keepLibraryColumnsVisibleInNarrowLayout ||
          $appearanceSettings.keepEmptyWorkspacePanelsOpen !== DEFAULT_APPEARANCE_SETTINGS.keepEmptyWorkspacePanelsOpen ||
          $appearanceSettings.collapseSingleTabWorkspaceBar !== DEFAULT_APPEARANCE_SETTINGS.collapseSingleTabWorkspaceBar;
        break;
      case 'lyrics':
        advancedTweaksModified =
          $appearanceSettings.lyrics.theaterDowntimeThresholdSeconds !== DEFAULT_APPEARANCE_SETTINGS.lyrics.theaterDowntimeThresholdSeconds;
        break;
      case 'now-playing':
        advancedTweaksModified =
          $appearanceSettings.multiplayerFloaterSize !== DEFAULT_APPEARANCE_SETTINGS.multiplayerFloaterSize ||
          $appearanceSettings.multiplayerFloaterMotion !== DEFAULT_APPEARANCE_SETTINGS.multiplayerFloaterMotion;
        break;
      case 'playback':
        advancedTweaksModified =
          $playbackSettings.patternAwareSeek !== DEFAULT_PLAYBACK_SETTINGS.patternAwareSeek ||
          $playbackSettings.rememberProgressDurationIndex !== DEFAULT_PLAYBACK_SETTINGS.rememberProgressDurationIndex ||
          $playbackSettings.logarithmicVolume !== DEFAULT_PLAYBACK_SETTINGS.logarithmicVolume ||
          $playbackSettings.gaplessPlayback !== DEFAULT_PLAYBACK_SETTINGS.gaplessPlayback ||
          $playbackSettings.fadeDurationSeconds !== DEFAULT_PLAYBACK_SETTINGS.fadeDurationSeconds ||
          $playbackSettings.manualTrackChangeFadePercent !== DEFAULT_PLAYBACK_SETTINGS.manualTrackChangeFadePercent;
        break;
      case 'oda':
        advancedTweaksModified =
          $odaSettings.odaArrowRepeatInitialDelayMs !== DEFAULT_ODA_SETTINGS.odaArrowRepeatInitialDelayMs ||
          $odaSettings.odaArrowRepeatIntervalMs !== DEFAULT_ODA_SETTINGS.odaArrowRepeatIntervalMs ||
          $odaSettings.odaHoldBackAction !== DEFAULT_ODA_SETTINGS.odaHoldBackAction ||
          $odaSettings.odaHoldBackThresholdMs !== DEFAULT_ODA_SETTINGS.odaHoldBackThresholdMs ||
          $odaSettings.odaScreensaverMoveIntervalMinutes !== DEFAULT_ODA_SETTINGS.odaScreensaverMoveIntervalMinutes;
        break;
      case 'visualizer':
        advancedTweaksModified =
          $visualizerSettings.postRaf !== DEFAULT_VISUALIZER_SETTINGS.postRaf ||
          $visualizerSettings.frameRateLimit !== DEFAULT_VISUALIZER_SETTINGS.frameRateLimit ||
          $visualizerSettings.normalizationStrength !== DEFAULT_VISUALIZER_SETTINGS.normalizationStrength ||
          $visualizerSettings.triangleCount !== DEFAULT_VISUALIZER_SETTINGS.triangleCount ||
          $visualizerSettings.triangleMinSize !== DEFAULT_VISUALIZER_SETTINGS.triangleMinSize ||
          $visualizerSettings.triangleMaxSize !== DEFAULT_VISUALIZER_SETTINGS.triangleMaxSize ||
          $visualizerSettings.triangleBaseSpeed !== DEFAULT_VISUALIZER_SETTINGS.triangleBaseSpeed ||
          $visualizerSettings.triangleReactiveSpeed !== DEFAULT_VISUALIZER_SETTINGS.triangleReactiveSpeed ||
          $visualizerSettings.triangleBorderWidth !== DEFAULT_VISUALIZER_SETTINGS.triangleBorderWidth;
        break;
      case 'patterns':
        advancedTweaksModified =
          $patternViewerSettings.rowHeight !== DEFAULT_PATTERN_VIEWER_SETTINGS.rowHeight ||
          $patternViewerSettings.channelWidth !== DEFAULT_PATTERN_VIEWER_SETTINGS.channelWidth;
        break;
      case 'tracks':
        advancedTweaksModified =
          $trackSettings.folderNestingLimit !== DEFAULT_TRACK_SETTINGS.folderNestingLimit ||
          $trackSettings.verifyAddedFiles !== DEFAULT_TRACK_SETTINGS.verifyAddedFiles;
        break;
      case 'metadata':
        advancedTweaksModified =
          $metadataSettings.playCountThresholdSeconds !== DEFAULT_METADATA_SETTINGS.playCountThresholdSeconds;
        break;
      case 'hosting':
        advancedTweaksModified =
          $multiplayerSettings.multiplayerBuiltinIceUrls !== DEFAULT_MULTIPLAYER_SETTINGS.multiplayerBuiltinIceUrls ||
          $multiplayerSettings.multiplayerBuiltinAllowedOrigins !== DEFAULT_MULTIPLAYER_SETTINGS.multiplayerBuiltinAllowedOrigins;
        break;
      default:
        advancedTweaksModified = false;
    }
  }
</script>

{#if mobileMode}
<MobileOptionsView
  windowTitle={$t('options.windowTitle', { default: 'izci Options' })}
  groups={sharedViewGroups}
  {auxiliaryViews}
  activeView={activeView}
  bind:showAdvancedTweaks
  advancedTweaksModified={advancedTweaksModified}
  expandHintsLabel={$t('options.tools.expandHints', { default: 'Expand field hints' })}
  collapseHintsLabel={$t('options.tools.collapseHints', { default: 'Collapse field hints' })}
  showAdvancedTweaksLabel={$t('options.tools.showAdvancedTweaks', { default: 'Show advanced tweaks' })}
  showModifiedAdvancedTweaksLabel={$t('options.tools.showAdvancedTweaksModified', { default: 'Show advanced tweaks — some differ from defaults' })}
  hideAdvancedTweaksLabel={$t('options.tools.hideAdvancedTweaks', { default: 'Hide advanced tweaks' })}
  resetPageLabel={$t('options.tools.resetPage', { default: 'Reset current page to defaults' })}
  contentClass={activeView === 'raf' ? 'raf-content' : activeView === 'about' ? 'about-content-panel' : ''}
  {embedded}
  on:select={(event) => setActiveView(event.detail.view as OptionsViewName)}
  on:back={() => dispatch('close')}
  on:reset={resetCurrentView}
  on:advancedvisibilitychange={(event) => rememberShowAdvancedTweaks(event.detail.visible)}
>
  <OptionsContent {activeView} onSelectView={setActiveView} mobilePresentation />
</MobileOptionsView>
{:else}
<OptionsView
  {embedded}
  windowTitle={$t('options.windowTitle', { default: 'izci Options' })}
  pageToolsLabel={$t('options.tools.label', { default: 'Page tools' })}
  categoriesLabel={$t('options.categories', { default: 'Options categories' })}
  groups={desktopViewGroups}
  {auxiliaryViews}
  activeView={activeView}
  bind:showAdvancedTweaks
  advancedTweaksModified={advancedTweaksModified}
  expandHintsLabel={$t('options.tools.expandHints', { default: 'Expand field hints' })}
  collapseHintsLabel={$t('options.tools.collapseHints', { default: 'Collapse field hints' })}
  showAdvancedTweaksLabel={$t('options.tools.showAdvancedTweaks', { default: 'Show advanced tweaks' })}
  showModifiedAdvancedTweaksLabel={$t('options.tools.showAdvancedTweaksModified', { default: 'Show advanced tweaks — some differ from defaults' })}
  hideAdvancedTweaksLabel={$t('options.tools.hideAdvancedTweaks', { default: 'Hide advanced tweaks' })}
  resetPageLabel={$t('options.tools.resetPage', { default: 'Reset current page to defaults' })}
  contentClass={activeView === 'raf' ? 'raf-content' : activeView === 'about' ? 'about-content-panel' : ''}
  on:select={(event) => setActiveView(event.detail.view as OptionsViewName)}
  on:reset={resetCurrentView}
  on:advancedvisibilitychange={(event) => rememberShowAdvancedTweaks(event.detail.visible)}
>
  <OptionsContent {activeView} onSelectView={setActiveView} />
</OptionsView>
{/if}
