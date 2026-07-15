<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import AboutView from './components/views/AboutView.svelte';
  import ExperimentalView from './components/views/ExperimentalView.svelte';
  import AppearanceView from './components/views/AppearanceView.svelte';
  import BackdropsView from './components/views/BackdropsView.svelte';
  import LyricsView from './components/views/LyricsView.svelte';
  import MetadataView from './components/views/MetadataView.svelte';
  import ModulesView from './components/views/ModulesView.svelte';
  import NowPlayingView from './components/views/NowPlayingView.svelte';
  import PlaybackView from './components/views/PlaybackView.svelte';
  import TracksView from './components/views/TracksView.svelte';
  import VisualizerView from './components/views/VisualizerView.svelte';
  import RafView from './components/raf/RafView.svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import {
    getOptionsWindowState,
    rememberOptionsActiveView,
    rememberOptionsWindowSize
  } from '$lib/services/options-window-state';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { metadataSettings } from '$lib/stores/metadata-settings';
  import { experimentalSettings } from '$lib/stores/experimental-settings';
  import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { trackSettings } from '$lib/stores/track-settings';
  import { visualizerSettings } from '$lib/stores/visualizer-settings';
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
  const requestedView = getOptionsViewFromLocation(window.location);
  let activeView: OptionsViewName = embedded
    ? initialView ?? getOptionsWindowState().activeView
    : window.location.search
      ? requestedView
      : getOptionsWindowState().activeView;
  if (activeView === 'raf' && !playbackSettings.getSnapshot().enableRaf) {
    activeView = 'playback';
  }
  let fieldHintsExpanded = false;
  let lastHandledInitialView = initialView;

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

  function closeOptions() {
    if (embedded) {
      dispatch('close');
      return;
    }

    window.close();
  }

  function resetCurrentView() {
    if (activeView === 'appearance' || activeView === 'backdrops' || activeView === 'now-playing' || activeView === 'lyrics') {
      appearanceSettings.reset();
    } else if (activeView === 'playback') {
      playbackSettings.reset();
    } else if (activeView === 'visualizer') {
      visualizerSettings.reset();
    } else if (activeView === 'raf') {
      rafSettings.reset();
    } else if (activeView === 'modules') {
      modulePlaybackSettings.reset();
    } else if (activeView === 'tracks') {
      trackSettings.reset();
    } else if (activeView === 'metadata') {
      metadataSettings.reset();
    } else if (activeView === 'experimental') {
      experimentalSettings.reset();
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

    if (!embedded) {
      window.addEventListener('popstate', syncActiveViewFromLocation);
      window.addEventListener('resize', rememberWindowSize);
    }
    if (!embedded) {
      window.addEventListener('message', handleMessage);
      window.addEventListener('focus', closeIfMainWindowClosed);
      document.addEventListener('visibilitychange', closeIfMainWindowClosed);
    }
    const openerCheckInterval = embedded ? null : window.setInterval(closeIfMainWindowClosed, 1000);

    return () => {
      if (openerCheckInterval !== null) {
        window.clearInterval(openerCheckInterval);
      }
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
  $: hintToggleLabel = fieldHintsExpanded ? 'Collapse field hints' : 'Expand field hints';
  $: if (embedded && initialView && initialView !== lastHandledInitialView) {
    lastHandledInitialView = initialView;
    setActiveView(initialView);
  }
  $: if (!embedded && $experimentalSettings.singlePageMode && window.opener) {
    window.opener.postMessage(
      { type: 'izci:open-options-single-page', view: activeView },
      window.location.origin
    );
    window.close();
  }
</script>

<svelte:head>
  {#if !embedded}
    <title>izci Options</title>
  {/if}
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
      <span class="window-topbar-prefix">izci Options</span>
      <span class="material-symbols-outlined window-topbar-separator window-topbar-prefix-separator" aria-hidden="true">
        chevron_right
      </span>
      <span class="window-topbar-breadcrumbs">
        {#if activeViewDefinition.parentLabel}
          <span class="window-topbar-crumb window-topbar-parent">{activeViewDefinition.parentLabel}</span>
          <span class="material-symbols-outlined window-topbar-separator window-topbar-parent-separator" aria-hidden="true">
            chevron_right
          </span>
        {/if}
        <span class="window-topbar-crumb is-current">{activeViewDefinition.label}</span>
      </span>
    </div>

    <div class="window-topbar-tools" aria-label="Page tools">
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
        aria-label="Reset current page to defaults"
        title="Reset current page to defaults"
        disabled={!canResetCurrentView}
        on:click={resetCurrentView}
      >
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
      </button>

      {#if embedded}
        <button
          class="tool-button"
          type="button"
          aria-label="Close Options"
          title="Close Options"
          on:click={closeOptions}
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      {/if}
    </div>
  </header>

  <main class="options-main">
    <aside class="tree-panel" aria-label="Options categories">
      <div class="tree" role="tree" aria-label="Options categories">
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
                  <span class="tree-label">{view.label}</span>
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

      {#if activeView === 'visualizer'}
        <VisualizerView />
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

      {#if activeView === 'metadata'}
        <MetadataView />
      {/if}

      {#if activeView === 'experimental'}
        <ExperimentalView />
      {/if}

      {#if activeView === 'about'}
        <AboutView />
      {/if}
    </section>
  </main>
</div>
