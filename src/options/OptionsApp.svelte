<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import AboutView from './components/views/AboutView.svelte';
  import AppearanceView from './components/views/AppearanceView.svelte';
  import BackdropsView from './components/views/BackdropsView.svelte';
  import LyricsView from './components/views/LyricsView.svelte';
  import MetadataView from './components/views/MetadataView.svelte';
  import ModulesView from './components/views/ModulesView.svelte';
  import NowPlayingView from './components/views/NowPlayingView.svelte';
  import PlaybackView from './components/views/PlaybackView.svelte';
  import PatternsView from './components/views/PatternsView.svelte';
  import TracksView from './components/views/TracksView.svelte';
  import FoldersView from './components/views/FoldersView.svelte';
  import LicensesView from './components/views/LicensesView.svelte';
  import VisualizerView from './components/views/VisualizerView.svelte';
  import VideoView from './components/views/VideoView.svelte';
  import RafView from './components/raf/RafView.svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import {
    getOptionsWindowState,
    rememberOptionsActiveView,
    rememberOptionsWindowSize
  } from '$lib/services/options-window-state';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { metadataSettings } from '$lib/stores/metadata-settings';
  import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import { patternViewerSettings } from '$lib/stores/pattern-viewer-settings';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { trackSettings } from '$lib/stores/track-settings';
  import { visualizerSettings } from '$lib/stores/visualizer-settings';
  import { videoSettings } from '$lib/stores/video-settings';
  import {
    OPTIONS_VIEW_GROUPS,
    OPTIONS_VIEWS,
    buildOptionsWindowPath,
    getOptionsViewFromLocation,
    isOptionsViewName,
    type OptionsViewName
  } from './views';

  const requestedView = getOptionsViewFromLocation(window.location);
  let activeView: OptionsViewName = window.location.search
    ? requestedView
    : getOptionsWindowState().activeView;
  if (activeView === 'raf' && !playbackSettings.getSnapshot().enableRaf) {
    activeView = 'playback';
  }
  let fieldHintsExpanded = false;

  function viewLabel(view: OptionsViewName, _translate: typeof $t): string {
    switch (view) {
      case 'appearance': return $t('options.views.appearance', { default: 'Appearance' });
      case 'backdrops': return $t('options.views.backdrops', { default: 'Backdrops' });
      case 'now-playing': return $t('options.views.nowPlaying', { default: 'Now Playing' });
      case 'lyrics': return $t('options.views.lyrics', { default: 'Lyrics' });
      case 'playback': return $t('options.views.playback', { default: 'Playback' });
      case 'video': return $t('options.views.video', { default: 'Video' });
      case 'raf': return 'Raf';
      case 'visualizer': return $t('options.views.visualizer', { default: 'Visualizer' });
      case 'patterns': return $t('options.views.patterns', { default: 'Patterns' });
      case 'modules': return $t('options.views.modules', { default: 'Modules' });
      case 'tracks': return $t('options.views.tracks', { default: 'Tracks' });
      case 'folders': return $t('options.views.folders', { default: 'Folders' });
      case 'metadata': return $t('options.views.metadata', { default: 'Metadata' });
      case 'about': return $t('options.views.about', { default: 'About' });
      case 'licenses': return $t('options.views.licenses', { default: 'Licenses' });
    }
  }

  function parentViewId(view: OptionsViewName): OptionsViewName | null {
    if (view === 'backdrops' || view === 'now-playing' || view === 'visualizer' || view === 'patterns' || view === 'lyrics') return 'appearance';
    if (view === 'video' || view === 'raf' || view === 'modules') return 'playback';
    if (view === 'folders' || view === 'metadata') return 'tracks';
    if (view === 'licenses') return 'about';
    return null;
  }

  function setActiveView(view: OptionsViewName) {
    if (view === 'raf' && !playbackSettings.getSnapshot().enableRaf) {
      view = 'playback';
    }
    activeView = view;
    rememberOptionsActiveView(view);

    const nextUrl = buildOptionsWindowPath(view);
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }

  function resetCurrentView() {
    if (activeView === 'appearance' || activeView === 'backdrops' || activeView === 'now-playing' || activeView === 'lyrics') {
      appearanceSettings.reset();
    } else if (activeView === 'playback') {
      playbackSettings.reset();
    } else if (activeView === 'video') {
      videoSettings.reset();
    } else if (activeView === 'visualizer') {
      visualizerSettings.reset();
    } else if (activeView === 'patterns') {
      patternViewerSettings.reset();
    } else if (activeView === 'raf') {
      rafSettings.reset();
    } else if (activeView === 'modules') {
      modulePlaybackSettings.reset();
    } else if (activeView === 'tracks') {
      trackSettings.reset();
    } else if (activeView === 'metadata') {
      metadataSettings.reset();
    }
  }

  function handleWindowContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  onMount(() => {
    rememberOptionsActiveView(activeView);
    const rememberWindowSize = () => rememberOptionsWindowSize(window.outerWidth, window.outerHeight);
    const syncActiveViewFromLocation = () => setActiveView(getOptionsViewFromLocation(window.location));
    const wasOpenedByMainWindow = window.opener !== null;
    const closeIfMainWindowClosed = () => {
      if (wasOpenedByMainWindow && (!window.opener || window.opener.closed)) {
        window.close();
      }
    };
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
    window.addEventListener('resize', rememberWindowSize);
    window.addEventListener('message', handleMessage);
    window.addEventListener('focus', closeIfMainWindowClosed);
    document.addEventListener('visibilitychange', closeIfMainWindowClosed);
    const openerCheckInterval = window.setInterval(closeIfMainWindowClosed, 1000);

    return () => {
      window.clearInterval(openerCheckInterval);
      window.removeEventListener('popstate', syncActiveViewFromLocation);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('resize', rememberWindowSize);
      window.removeEventListener('focus', closeIfMainWindowClosed);
      document.removeEventListener('visibilitychange', closeIfMainWindowClosed);
    };
  });

  $: overlayState = $windowControlsOverlayState;
  $: if (activeView === 'raf' && !$playbackSettings.enableRaf) {
    setActiveView('playback');
  }
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';
  $: activeViewDefinition = OPTIONS_VIEWS[activeView];
  $: canResetCurrentView = activeViewDefinition.resettable;
  $: canToggleHints = activeViewDefinition.hasHints;
  $: hintToggleLabel = fieldHintsExpanded
    ? $t('options.tools.collapseHints', { default: 'Collapse field hints' })
    : $t('options.tools.expandHints', { default: 'Expand field hints' });
  $: activeParentView = parentViewId(activeView);
</script>

<svelte:head>
  <title>{$t('options.windowTitle', { default: 'izci Options' })}</title>
</svelte:head>

<svelte:window
  on:contextmenu={handleWindowContextMenu}
/>

<div
  class="options-shell"
  class:hints-expanded={fieldHintsExpanded}
  class:window-controls-overlay-active={overlayState.visible}
>
  <header
    class="window-topbar"
    class:window-controls-overlay-active={overlayState.visible}
    style={overlayInlineStyle}
  >
    <div class="window-topbar-title" aria-live="polite">
      <span class="window-topbar-prefix">{$t('options.windowTitle', { default: 'izci Options' })}</span>
      <span class="material-symbols-outlined window-topbar-separator window-topbar-prefix-separator" aria-hidden="true">
        chevron_right
      </span>
      <span class="window-topbar-breadcrumbs">
        {#if activeParentView}
          <span class="window-topbar-crumb window-topbar-parent">{viewLabel(activeParentView, $t)}</span>
          <span class="material-symbols-outlined window-topbar-separator window-topbar-parent-separator" aria-hidden="true">
            chevron_right
          </span>
        {/if}
        <span class="window-topbar-crumb is-current">{viewLabel(activeView, $t)}</span>
      </span>
    </div>

    <div class="window-topbar-tools" aria-label={$t('options.tools.label', { default: 'Page tools' })}>
      <button
        class="tool-button"
        type="button"
        aria-label={hintToggleLabel}
        title={hintToggleLabel}
        disabled={!canToggleHints}
        on:click={() => (fieldHintsExpanded = !fieldHintsExpanded)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {fieldHintsExpanded ? 'unfold_less' : 'unfold_more'}
        </span>
      </button>

      <button
        class="tool-button"
        type="button"
        aria-label={$t('options.tools.resetPage', { default: 'Reset current page to defaults' })}
        title={$t('options.tools.resetPage', { default: 'Reset current page to defaults' })}
        disabled={!canResetCurrentView}
        on:click={resetCurrentView}
      >
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
      </button>

    </div>
  </header>

  <main class="options-main">
    <aside class="tree-panel" aria-label={$t('options.categories', { default: 'Options categories' })}>
      <div class="tree" role="tree" aria-label={$t('options.categories', { default: 'Options categories' })}>
        {#each OPTIONS_VIEW_GROUPS as group}
          <div class="tree-group" role="none">
            {#each group as view}
              {#if view.id !== 'raf' || $playbackSettings.enableRaf}
                <button
                  class="tree-item"
                  class:child={view.parentLabel !== ''}
                  type="button"
                  role="treeitem"
                  aria-selected={activeView === view.id}
                  on:click={() => setActiveView(view.id)}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">{view.icon}</span>
                  <span class="tree-label">{viewLabel(view.id, $t)}</span>
                </button>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    </aside>

    <section class="content-panel" class:raf-content={activeView === 'raf'} aria-live="polite">
      {#if activeView === 'appearance'}
        <AppearanceView />
      {/if}

      {#if activeView === 'backdrops'}
        <BackdropsView />
      {/if}

      {#if activeView === 'now-playing'}
        <NowPlayingView />
      {/if}

      {#if activeView === 'lyrics'}
        <LyricsView />
      {/if}

      {#if activeView === 'playback'}
        <PlaybackView />
      {/if}

      {#if activeView === 'video'}
        <VideoView />
      {/if}

      {#if activeView === 'visualizer'}
        <VisualizerView />
      {/if}

      {#if activeView === 'patterns'}
        <PatternsView />
      {/if}

      {#if activeView === 'raf'}
        <RafView />
      {/if}

      {#if activeView === 'modules'}
        <ModulesView />
      {/if}

      {#if activeView === 'tracks'}
        <TracksView />
      {/if}

      {#if activeView === 'folders'}
        <FoldersView />
      {/if}

      {#if activeView === 'metadata'}
        <MetadataView />
      {/if}

      {#if activeView === 'about'}
        <AboutView onOpenLicenses={() => setActiveView('licenses')} />
      {/if}

      {#if activeView === 'licenses'}
        <LicensesView />
      {/if}
    </section>
  </main>
</div>
