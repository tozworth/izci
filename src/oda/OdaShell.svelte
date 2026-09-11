<script lang="ts">
  import type { OdaSettings, PlaybackSnapshot, RepeatMode, TrackItem } from '$lib/types';
  import type { OdaRoute, OdaSession, OdaSessionSnapshot } from '$lib/services/oda-session';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import { DEFAULT_ODA_SETTINGS } from '$lib/stores/oda-settings';
  import type { OptionsViewName } from '../options/views';
  import OdaHome from './views/OdaHome.svelte';
  import OdaListRoute from './views/OdaListRoute.svelte';
  import OdaNowPlaying from './views/OdaNowPlaying.svelte';
  import OdaOptions from './views/OdaOptions.svelte';
  import OdaPlaceholderRoute from './views/OdaPlaceholderRoute.svelte';
  import type { OdaCommands } from './oda-commands';
  import type { OdaTranslate } from './oda-translate';
  import type { OdaCardModel } from './oda-destinations';
  import {
    buildOdaHomeSections,
    resolveNowPlayingRoute,
    resolveOdaMediaCounts,
    selectOdaImages,
    selectOdaMusic,
    selectOdaRecents,
    selectOdaVideos
  } from './oda-destinations';
  import {
    createListFocusModel,
    createWaterfallFocusModel,
    findWaterfallFocus,
    INITIAL_WATERFALL_FOCUS,
    waterfallCardFocusId,
    waterfallFocusId,
    type OdaFocusModel,
    type OdaWaterfallSection
  } from './oda-navigation';
  import type { OdaFocusController, OdaTransportAction } from './oda-focus';
  import {
    buildOdaOptionsGroups,
    ODA_OPTIONS_EXIT_FOCUS_ID,
    odaOptionsCategoryFocusId
  } from './oda-options-groups';

  export let session: OdaSession;
  export let sessionState: OdaSessionSnapshot;
  export let focus: OdaFocusController;
  export let settings: OdaSettings;
  export let translate: OdaTranslate;
  export let libraryItems: TrackItem[] = [];
  export let queueItems: TrackItem[] = [];
  export let playingTrack: TrackItem | null = null;
  export let playbackSnapshot: PlaybackSnapshot;
  export let artworkUrl: string | null = null;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let canMutateQueue = true;
  export let playbackError: string | null = null;
  export let commands: OdaCommands;

  const ITEM_PREFIX = 'item:';

  function itemFocusId(id: string): string {
    return `${ITEM_PREFIX}${id}`;
  }

  $: counts = resolveOdaMediaCounts(libraryItems);
  $: homeSections = buildOdaHomeSections(counts);
  $: homeWaterfallSections = homeSections.map((section): OdaWaterfallSection => ({
    id: section.id,
    cardIds: section.cards.map((card) => card.id)
  }));
  $: musicItems = selectOdaMusic(libraryItems);
  $: videoItems = selectOdaVideos(libraryItems);
  $: imageItems = selectOdaImages(libraryItems);
  $: recentsItems = selectOdaRecents(libraryItems);
  $: activeRoute = sessionState.route;

  $: odaOptions = buildOdaOptionsGroups(translate, $playbackSettings.enableRaf);
  $: optionCategoryIds = odaOptions.groups
    .flat()
    .filter((view) => !view.hidden)
    .map((view) => odaOptionsCategoryFocusId(view.id as OptionsViewName));

  $: browseItems = activeRoute.name === 'browse'
    ? activeRoute.medium === 'music'
      ? musicItems
      : activeRoute.medium === 'video'
        ? videoItems
        : imageItems
    : [];
  $: browsePlaceholder =
    activeRoute.name === 'browse'
    && activeRoute.medium === 'music'
    && activeRoute.view !== 'tracks';
  $: odaOptionsAdvancedModified =
    activeRoute.name === 'options'
    && activeRoute.view === 'oda'
    && (
      settings.odaArrowRepeatInitialDelayMs !== DEFAULT_ODA_SETTINGS.odaArrowRepeatInitialDelayMs
      || settings.odaArrowRepeatIntervalMs !== DEFAULT_ODA_SETTINGS.odaArrowRepeatIntervalMs
      || settings.odaHoldBackAction !== DEFAULT_ODA_SETTINGS.odaHoldBackAction
      || settings.odaHoldBackThresholdMs !== DEFAULT_ODA_SETTINGS.odaHoldBackThresholdMs
    );
  $: routeListItems = activeRoute.name === 'recents'
    ? recentsItems
    : activeRoute.name === 'browse'
      ? browseItems
      : activeRoute.name === 'queue' || activeRoute.name === 'now-playing'
        ? queueItems
        : [];

  function resolveRouteFocusIds(route: OdaRoute): string[] {
    if (route.name === 'options') {
      return [ODA_OPTIONS_EXIT_FOCUS_ID, ...optionCategoryIds];
    }
    return routeListItems.map((item) => itemFocusId(item.id));
  }

  function defaultFocusId(): string | null {
    if (activeRoute.name === 'home') {
      return waterfallFocusId(INITIAL_WATERFALL_FOCUS, homeWaterfallSections);
    }
    if (activeRoute.name === 'options') {
      return optionCategoryIds[0] ?? ODA_OPTIONS_EXIT_FOCUS_ID;
    }
    return routeListItems[0] ? itemFocusId(routeListItems[0].id) : null;
  }

  function focusIdExists(id: string): boolean {
    if (activeRoute.name === 'home') {
      return findWaterfallFocus(id, homeWaterfallSections) !== null;
    }
    return resolveRouteFocusIds(activeRoute).includes(id);
  }

  function resolveRouteModel(route: OdaRoute): OdaFocusModel | null {
    if (route.name === 'home') return createWaterfallFocusModel(homeWaterfallSections);
    if (route.name === 'options') {
      return createListFocusModel([ODA_OPTIONS_EXIT_FOCUS_ID, ...optionCategoryIds]);
    }
    if (route.name === 'browse' || route.name === 'recents' || route.name === 'queue' || route.name === 'now-playing') {
      return createListFocusModel(routeListItems.map((item) => itemFocusId(item.id)));
    }
    return null;
  }

  // Options has a persistent category list plus a content pane. Back steps
  // from content back to the category list before unwinding the route stack.
  let optionsContentActive = false;
  let lastOptionsFocusId: string | null = null;
  let lastRouteKey = '';
  $: {
    const routeKey = activeRoute.name === 'options' ? 'options' : activeRoute.name;
    if (routeKey !== lastRouteKey) {
      lastRouteKey = routeKey;
      optionsContentActive = false;
      lastOptionsFocusId = null;
    }
  }

  let lastFocusToken = -1;
  $: if (sessionState.active && sessionState.focusRequestToken !== lastFocusToken) {
    lastFocusToken = sessionState.focusRequestToken;
    applyInitialRouteFocus();
  }

  function applyInitialRouteFocus(): void {
    const restore = sessionState.restoreFocusId;
    if (restore && focusIdExists(restore)) {
      focus.setFocus(restore);
      return;
    }
    focus.setFocus(defaultFocusId());
  }

  $: focus.setModel(optionsContentActive ? null : resolveRouteModel(activeRoute));

  $: focus.setHandlers({
    onActivate: (focusId) => handleActivate(focusId),
    onBack: () => handleBack(),
    onHoldBack: () => session.goHome(),
    onTransport: (action) => handleTransport(action)
  });

  function activateHomeCard(card: OdaCardModel): void {
    if (card.command === 'exit-oda') {
      commands.exitOda();
      return;
    }
    if (card.id === 'now-playing') {
      session.push(resolveNowPlayingRoute(playingTrack));
      return;
    }
    if (card.id === 'queue') {
      session.push({ name: 'queue' });
      return;
    }
    if (card.route) session.push(card.route);
  }

  function handleHomeActivate(focusId: string | null): void {
    const position = findWaterfallFocus(focusId, homeWaterfallSections);
    if (!position) return;
    const section = homeSections[position.sectionIndex];
    if (!section) return;

    if (!position.onCards) {
      const firstCard = section.cards[0];
      if (firstCard) focus.setFocus(waterfallCardFocusId(section.id, firstCard.id));
      return;
    }

    const card = section.cards[position.cardIndex];
    if (card) activateHomeCard(card);
  }

  function handleActivate(focusId: string | null): void {
    if (activeRoute.name === 'home') {
      handleHomeActivate(focusId);
      return;
    }
    if (activeRoute.name === 'options') {
      if (focusId === ODA_OPTIONS_EXIT_FOCUS_ID) {
        commands.exitOda();
        return;
      }
      if (focusId?.startsWith('option:')) {
        selectOptionsView(focusId.slice('option:'.length) as OptionsViewName, focusId);
      }
      return;
    }
    if (focusId?.startsWith(ITEM_PREFIX)) {
      const id = focusId.slice(ITEM_PREFIX.length);
      if (activeRoute.name === 'queue' || activeRoute.name === 'now-playing') {
        void commands.activateQueueTrack(id);
      } else {
        void commands.activateLibraryTrack(id);
      }
    }
  }

  function selectOptionsView(view: OptionsViewName, focusId: string): void {
    optionsContentActive = true;
    lastOptionsFocusId = focusId;
    session.setOptionsView(view);
    focus.setFocus(null);
  }

  function handleBack(): void {
    if (activeRoute.name === 'options' && optionsContentActive) {
      optionsContentActive = false;
      focus.setFocus(lastOptionsFocusId ?? defaultFocusId());
      return;
    }
    session.back();
  }

  function handleTransport(action: OdaTransportAction): void {
    if (action === 'play-pause') commands.togglePlayback();
    else if (action === 'stop') commands.stop();
    else if (action === 'previous') commands.stepTrack(-1);
    else if (action === 'next') commands.stepTrack(1);
  }

  function browseTitle(route: Extract<OdaRoute, { name: 'browse' }>): string {
    if (route.medium === 'video') return translate('oda.cards.browseVideos', 'Browse videos');
    if (route.medium === 'image') return translate('oda.cards.browseImages', 'Browse images');
    switch (route.view) {
      case 'tracks': return translate('oda.cards.browseMusic', 'Browse music');
      case 'artists': return translate('oda.cards.artists', 'Artists');
      case 'albums': return translate('oda.cards.albums', 'Albums');
      case 'songs': return translate('oda.cards.songs', 'Songs');
      case 'genres': return translate('oda.cards.genres', 'Genres');
      case 'years': return translate('oda.cards.years', 'Years');
      case 'formats': return translate('oda.cards.formats', 'Formats');
      case 'folders': return translate('oda.cards.folders', 'Folders');
    }
  }

  function handleCardActivate(card: OdaCardModel): void {
    activateHomeCard(card);
  }
</script>

<div
  class="oda-shell"
  style={`--oda-overscan-percent: ${settings.odaOverscanPercent}`}
  data-oda-active="true"
>
  <div class="oda-overscan">
    {#if activeRoute.name === 'home'}
      <OdaHome
        sections={homeSections}
        focusId={sessionState.focusId}
        {translate}
        {playingTrack}
        {playbackSnapshot}
        {artworkUrl}
        queueCount={queueItems.length}
        onActivate={handleCardActivate}
        onFocus={(focusId) => focus.setFocus(focusId)}
      />
    {:else if activeRoute.name === 'browse'}
      {#if browsePlaceholder}
        <OdaPlaceholderRoute
          title={browseTitle(activeRoute)}
          message={translate('oda.browse.groupedLater', 'Grouped browsing arrives in a later phase.')}
          {translate}
        />
      {:else}
        <OdaListRoute
          title={browseTitle(activeRoute)}
          subtitle={translate('oda.browse.count', '{count} items', { count: browseItems.length })}
          items={browseItems}
          focusId={sessionState.focusId}
          playingId={playingTrack?.id ?? null}
          emptyTitle={translate('oda.browse.emptyTitle', 'Nothing to browse')}
          emptyMessage={translate('oda.browse.empty', 'No library items of this kind have been added.')}
          {translate}
          onActivate={(id) => void commands.activateLibraryTrack(id)}
          onFocus={(focusId) => focus.setFocus(focusId)}
        />
      {/if}
    {:else if activeRoute.name === 'recents'}
      <OdaListRoute
        title={translate('oda.cards.browseRecents', 'Browse recently played')}
        subtitle={translate('oda.browse.count', '{count} items', { count: recentsItems.length })}
        items={recentsItems}
        focusId={sessionState.focusId}
        playingId={playingTrack?.id ?? null}
        emptyTitle={translate('oda.recents.emptyTitle', 'No recents')}
        emptyMessage={translate('oda.recents.empty', 'Nothing has been played yet.')}
        {translate}
        onActivate={(id) => void commands.activateLibraryTrack(id)}
        onFocus={(focusId) => focus.setFocus(focusId)}
      />
    {:else if activeRoute.name === 'queue'}
      <OdaListRoute
        title={translate('oda.cards.queue', 'Queue')}
        subtitle={translate('oda.browse.count', '{count} items', { count: queueItems.length })}
        items={queueItems}
        focusId={sessionState.focusId}
        playingId={playingTrack?.id ?? null}
        emptyTitle={translate('oda.queue.emptyTitle', 'The queue is empty')}
        emptyMessage={translate('oda.queue.empty', 'Add tracks from the library to build a queue.')}
        {translate}
        onActivate={(id) => void commands.activateQueueTrack(id)}
        onFocus={(focusId) => focus.setFocus(focusId)}
      />
    {:else if activeRoute.name === 'now-playing'}
      <OdaNowPlaying
        track={playingTrack}
        snapshot={playbackSnapshot}
        {artworkUrl}
        {queueItems}
        focusId={sessionState.focusId}
        {shuffleEnabled}
        {repeatMode}
        {canMutateQueue}
        {translate}
        onActivateQueueItem={(id) => void commands.activateQueueTrack(id)}
        onFocus={(focusId) => focus.setFocus(focusId)}
        onTogglePlayback={commands.togglePlayback}
        onStepTrack={commands.stepTrack}
        onSeek={commands.seek}
        onToggleShuffle={commands.toggleShuffle}
        onCycleRepeat={commands.cycleRepeat}
        onRemoveQueueItem={(id) => commands.removeQueueTracks([id])}
      />
    {:else if activeRoute.name === 'options'}
      <OdaOptions
        groups={odaOptions.groups}
        auxiliaryViews={odaOptions.auxiliaryViews}
        activeView={activeRoute.view}
        focusId={sessionState.focusId}
        {translate}
        advancedTweaksModified={odaOptionsAdvancedModified}
        onFocus={(focusId) => focus.setFocus(focusId)}
        onSelectView={(view) => selectOptionsView(view, odaOptionsCategoryFocusId(view))}
        onExitOda={commands.exitOda}
      />
    {:else if activeRoute.name === 'video-theater'}
      <OdaPlaceholderRoute
        title={translate('oda.theater.videoTitle', 'Video')}
        message={translate('oda.theater.videoLater', 'The Oda video theater arrives in a later phase. Playback keeps running.')}
        {translate}
      />
    {:else if activeRoute.name === 'image-theater'}
      <OdaPlaceholderRoute
        title={translate('oda.theater.imageTitle', 'Images')}
        message={translate('oda.theater.imageLater', 'The Oda image theater arrives in a later phase.')}
        {translate}
      />
    {/if}
  </div>

  {#if playbackError}
    <div class="oda-notices">
      <div class="oda-notice is-error" role="alert">
        <span>{playbackError}</span>
        {#if commands.dismissPlaybackError}
          <button type="button" on:click={commands.dismissPlaybackError}>
            {translate('main.common.close', 'Close')}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <p class="oda-hint">{translate('oda.hint', 'Arrows navigate · Enter selects · Escape goes back')}</p>
</div>
