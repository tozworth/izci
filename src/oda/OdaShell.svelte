<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { OdaBrowserLayout, OdaSettings, PlaybackSnapshot, RepeatMode, TrackItem } from '$lib/types';
  import type { OdaRoute, OdaSession, OdaSessionSnapshot } from '$lib/services/oda-session';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import { DEFAULT_ODA_SETTINGS, odaSettings } from '$lib/stores/oda-settings';
  import type { OptionsViewName } from '../options/views';
  import OdaBrowseRoute from './views/OdaBrowseRoute.svelte';
  import OdaHome from './views/OdaHome.svelte';
  import OdaImageTheater from './views/OdaImageTheater.svelte';
  import OdaListRoute from './views/OdaListRoute.svelte';
  import OdaNowPlaying from './views/OdaNowPlaying.svelte';
  import OdaOptions from './views/OdaOptions.svelte';
  import OdaQueueFlyout from './views/OdaQueueFlyout.svelte';
  import OdaScreensaver from './views/OdaScreensaver.svelte';
  import OdaTopChrome from './OdaTopChrome.svelte';
  import { version as appVersion } from '../../package.json';
  import OdaVideoTheater from './views/OdaVideoTheater.svelte';
  import type { OdaCommands, OdaMediaHost } from './oda-commands';
  import type { OdaTranslate } from './oda-translate';
  import { getTrackLyricsLoadKey, loadTrackLyrics } from '$lib/services/lyrics';
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
  import type { OdaMultiplayerHomeState } from './oda-destinations';
  import {
    odaBrowserFilterFromFocusId,
    odaBrowserLayoutFromFocusId,
    odaBrowserZoomFromFocusId,
    odaBrowseGroupKey,
    odaBrowseTrackId,
    odaTrackFocusId,
    resolveOdaBrowserColumns
  } from './oda-browse';
  import {
    findWaterfallFocus,
    waterfallCardFocusId,
    type OdaWaterfallSection
  } from './oda-navigation';
  import type { OdaFocusController, OdaTransportAction } from './oda-focus';
  import type { OdaDirection } from './oda-input';
  import {
    ODA_NP_LYRICS,
    ODA_NP_NEXT,
    ODA_NP_PLAY_PAUSE,
    ODA_NP_PREVIOUS,
    ODA_NP_PROGRESS,
    ODA_NP_QUEUE,
    ODA_NP_REPEAT,
    ODA_NP_SEEK_STEP_SECONDS,
    ODA_NP_SHUFFLE,
    ODA_NP_VOLUME,
    parseOdaNowPlayingQueueActionFocusId,
    resolveOdaNowPlayingRemovalTargetId
  } from './oda-now-playing';
  import {
    ODA_THEATER_FIT,
    ODA_THEATER_NEXT,
    ODA_THEATER_PLAY_PAUSE,
    ODA_THEATER_PREVIOUS,
    ODA_THEATER_PROGRESS,
    ODA_THEATER_SEEK_STEP_SECONDS
  } from './oda-theater';
  import {
    resolveOdaRouteDefaultFocusId,
    resolveOdaRouteFocusIds,
    resolveOdaRouteFocusModel,
    type OdaRouteFocusContext
  } from './oda-route-focus';
  import {
    buildOdaOptionsGroups,
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
  export let canReorderQueue = true;
  export let playbackError: string | null = null;
  export let media: OdaMediaHost;
  export let commands: OdaCommands;
  export let screensaverActive = false;
  export let screensaverActivityToken = 0;
  export let multiplayer: OdaMultiplayerHomeState | null = null;
  export let onMultiplayerHost: () => void = () => {};
  export let onMultiplayerStopHosting: () => void = () => {};
  export let onMultiplayerJoin: () => void = () => {};
  export let onMultiplayerLeave: () => void = () => {};

  let screensaverIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let screensaverMounted = false;
  let observedScreensaverActivityToken = screensaverActivityToken;
  let loadedBackgroundImage: string | null = null;
  let loadedBackgroundOpacity = 0;
  let backgroundLoadToken = 0;
  let backgroundRequestImage: string | null = null;
  let backgroundRequestOpacity = 0;

  async function prepareBackgroundImage(imageUrl: string | null, opacity: number): Promise<void> {
    if (imageUrl === backgroundRequestImage) {
      backgroundRequestOpacity = opacity;
      if (loadedBackgroundImage === imageUrl) {
        loadedBackgroundOpacity = Math.min(Math.max(opacity, 0), 100) / 100;
      }
      return;
    }
    backgroundRequestImage = imageUrl;
    backgroundRequestOpacity = opacity;
    const token = ++backgroundLoadToken;
    loadedBackgroundImage = null;
    if (!imageUrl) return;

    const image = new Image();
    image.src = imageUrl;
    try {
      await image.decode();
    } catch {
      return;
    }
    if (token !== backgroundLoadToken) return;
    loadedBackgroundImage = imageUrl;
    loadedBackgroundOpacity = Math.min(Math.max(backgroundRequestOpacity, 0), 100) / 100;
  }

  function clearScreensaverIdleTimer(): void {
    if (screensaverIdleTimer !== null) clearTimeout(screensaverIdleTimer);
    screensaverIdleTimer = null;
  }

  function scheduleScreensaver(): void {
    clearScreensaverIdleTimer();
    const delay = settings.odaScreensaverDelayMinutes;
    if (!screensaverMounted || delay <= 0 || screensaverActive) return;
    screensaverIdleTimer = setTimeout(() => {
      screensaverIdleTimer = null;
      screensaverActive = true;
    }, delay * 60_000);
  }

  function handleScreensaverActivity(): void {
    if (!screensaverMounted) return;
    if (screensaverActive) screensaverActive = false;
    scheduleScreensaver();
  }

  $: if (screensaverMounted) {
    void settings.odaScreensaverDelayMinutes;
    if (settings.odaScreensaverDelayMinutes <= 0 && screensaverActive) screensaverActive = false;
    scheduleScreensaver();
  }
  $: if (screensaverMounted && screensaverActivityToken !== observedScreensaverActivityToken) {
    observedScreensaverActivityToken = screensaverActivityToken;
    handleScreensaverActivity();
  }

  onMount(() => {
    screensaverMounted = true;
    observedScreensaverActivityToken = screensaverActivityToken;
    screensaverActive = false;
    scheduleScreensaver();
  });

  onDestroy(() => {
    backgroundLoadToken += 1;
    screensaverMounted = false;
    clearScreensaverIdleTimer();
    screensaverActive = false;
  });

  $: counts = resolveOdaMediaCounts(libraryItems);
  $: homeSections = buildOdaHomeSections(counts, multiplayer ?? undefined);
  $: homeWaterfallSections = homeSections.map((section): OdaWaterfallSection => ({
    id: section.id,
    cardIds: section.cards.map((card) => card.id)
  }));
  $: musicItems = selectOdaMusic(libraryItems);
  $: videoItems = selectOdaVideos(libraryItems);
  $: imageItems = selectOdaImages(libraryItems);
  $: recentsItems = selectOdaRecents(libraryItems);
  $: activeRoute = sessionState.route;
  $: activeBrowserMedium = activeRoute.name === 'browse' ? activeRoute.medium : 'music';
  $: activeBrowserLayout = settings.odaBrowserLayouts[activeBrowserMedium];
  $: activeBrowserZoomLevel = settings.odaBrowserZoomLevels[activeBrowserMedium][activeBrowserLayout];
  $: activeBrowserColumns = resolveOdaBrowserColumns(activeBrowserLayout, activeBrowserZoomLevel);

  $: odaOptions = buildOdaOptionsGroups(translate, $playbackSettings.enableRaf);
  $: optionCategoryIds = odaOptions.groups
    .flat()
    .filter((view) => !view.hidden)
    .map((view) => odaOptionsCategoryFocusId(view.id as OptionsViewName));

  // Options has a persistent category list plus a content pane. Back steps
  // from content back to the category list before unwinding the route stack.
  let optionsContentActive = false;
  let lastOptionsFocusId: string | null = null;
  let queueFlyoutOpen = false;
  let queueReturnFocusId: string | null = null;
  let lyricsVisible = true;
  let lyricsAvailable = false;
  let lyricsLoadToken = 0;
  let lyricsLoadedKey = '';
  let lastRouteKey = '';
  $: {
    const routeKey = activeRoute.name === 'options' ? 'options' : activeRoute.name;
    if (routeKey !== lastRouteKey) {
      lastRouteKey = routeKey;
      optionsContentActive = false;
      lastOptionsFocusId = null;
      if (activeRoute.name !== 'now-playing') {
        queueFlyoutOpen = false;
        queueReturnFocusId = null;
      }
    }
  }

  // Precompute the active route's focus IDs so per-keypress validation is a
  // cheap membership check instead of a full library regrouping.
  let routeFocusIds: string[] = [];
  $: {
    void libraryItems;
    void queueItems;
    void optionCategoryIds;
    void canMutateQueue;
    void canReorderQueue;
    void playingTrack;
    void queueFlyoutOpen;
    routeFocusIds = resolveOdaRouteFocusIds(activeRoute, focusContext());
  }

  function refreshLyricsAvailability(key: string, track: TrackItem | null): void {
    if (key === lyricsLoadedKey) return;
    lyricsLoadedKey = key;
    if (!key || !track) {
      lyricsLoadToken += 1;
      lyricsAvailable = false;
      return;
    }
    const token = ++lyricsLoadToken;
    lyricsAvailable = false;
    void loadTrackLyrics(track)
      .then((lyrics) => {
        if (token === lyricsLoadToken) lyricsAvailable = Boolean(lyrics);
      })
      .catch(() => {
        if (token === lyricsLoadToken) lyricsAvailable = false;
      });
  }

  $: lyricsTrackKey = getTrackLyricsLoadKey(playingTrack);
  $: refreshLyricsAvailability(lyricsTrackKey, playingTrack);
  $: lyricsOpen = lyricsVisible && lyricsAvailable;

  function focusContext(): OdaRouteFocusContext {
    return {
      musicItems,
      videoItems,
      imageItems,
      recentsItems,
      queueItems,
      optionCategoryIds,
      homeWaterfallSections,
      browserLayout: activeBrowserLayout,
      browserColumns: activeBrowserColumns,
      canMutateQueue,
      canReorderQueue,
      playingKind: playingTrack?.kind ?? null,
      playingTrackId: playingTrack?.id ?? null,
      queueFlyoutOpen
    };
  }

  function defaultFocusId(): string | null {
    return resolveOdaRouteDefaultFocusId(activeRoute, focusContext());
  }

  function focusIdExists(id: string): boolean {
    if (activeRoute.name === 'home') {
      return findWaterfallFocus(id, homeWaterfallSections) !== null;
    }
    return routeFocusIds.includes(id);
  }

  /** Fresh check used on route transitions, where the cached IDs may lag. */
  function focusIdExistsFresh(id: string): boolean {
    if (activeRoute.name === 'home') {
      return findWaterfallFocus(id, homeWaterfallSections) !== null;
    }
    return resolveOdaRouteFocusIds(activeRoute, focusContext()).includes(id);
  }

  function resolveRouteModel(route: OdaRoute) {
    return resolveOdaRouteFocusModel(route, focusContext());
  }

  let lastFocusToken = -1;
  $: if (sessionState.active && sessionState.focusRequestToken !== lastFocusToken) {
    lastFocusToken = sessionState.focusRequestToken;
    applyInitialRouteFocus();
  }

  function applyInitialRouteFocus(): void {
    const restore = sessionState.restoreFocusId;
    if (restore && focusIdExistsFresh(restore)) {
      focus.setFocus(restore);
      return;
    }
    focus.setFocus(defaultFocusId());
  }

  $: {
    // Rebuild the model when the effective collections or route change so
    // lists do not keep stale IDs after queue/library updates.
    void libraryItems;
    void queueItems;
    void optionsContentActive;
    void activeRoute;
    void activeBrowserLayout;
    void activeBrowserColumns;
    void canMutateQueue;
    void canReorderQueue;
    void playingTrack;
    void queueFlyoutOpen;
    focus.setModel(optionsContentActive ? null : resolveRouteModel(activeRoute));
  }

  // If the focused item disappears (queue removal, metadata refresh, group
  // change) fall back to a deliberate default instead of a stale ID.
  $: {
    void libraryItems;
    void queueItems;
    void homeWaterfallSections;
    void optionCategoryIds;
    void canMutateQueue;
    void canReorderQueue;
    void playingTrack;
    void queueFlyoutOpen;
    if (
      sessionState.active
      && !optionsContentActive
      && sessionState.focusId
      && !focusIdExists(sessionState.focusId)
    ) {
      focus.setFocus(defaultFocusId());
    }
  }

  $: focus.setHandlers({
    onActivate: (focusId) => handleActivate(focusId),
    onMove: (focusId, direction) => handleFocusMove(focusId, direction),
    onBack: () => handleBack(),
    onHoldBack: () => session.goHome(),
    onTransport: (action) => handleTransport(action)
  });

  async function activateAndRoute(focusId: string | null, source: 'library' | 'queue'): Promise<void> {
    const id = odaBrowseTrackId(focusId);
    if (!id) return;
    const activated = source === 'queue'
      ? await commands.activateQueueTrack(id)
      : await commands.activateLibraryTrack(id);
    routeToPresentation(activated ?? null);
  }

  function routeToPresentation(track: TrackItem | null): void {
    if (!track) return;
    session.push({ name: 'now-playing' });
  }

  function openQueueFlyout(): void {
    if (queueFlyoutOpen) return;
    // The queue button exists in every playback renderer, so it remains a
    // valid return target even when choosing an item swaps media kind.
    queueReturnFocusId = ODA_NP_QUEUE;
    queueFlyoutOpen = true;
    const activeId = playingTrack && queueItems.some((item) => item.id === playingTrack?.id)
      ? odaTrackFocusId(playingTrack.id)
      : queueItems[0]
        ? odaTrackFocusId(queueItems[0].id)
        : ODA_NP_QUEUE;
    focus.setFocus(activeId);
  }

  function closeQueueFlyout(): void {
    if (!queueFlyoutOpen) return;
    queueFlyoutOpen = false;
    focus.setFocus(queueReturnFocusId ?? defaultFocusId());
    queueReturnFocusId = null;
  }

  function toggleQueueFlyout(): void {
    if (queueFlyoutOpen) closeQueueFlyout();
    else openQueueFlyout();
  }

  function activateHomeCard(card: OdaCardModel): void {
    switch (card.command) {
      case 'exit-oda': commands.exitOda(); return;
      case 'multiplayer-host': onMultiplayerHost(); return;
      case 'multiplayer-stop-hosting': onMultiplayerStopHosting(); return;
      case 'multiplayer-join': onMultiplayerJoin(); return;
      case 'multiplayer-leave': onMultiplayerLeave(); return;
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

  function openBrowseGroup(groupKey: string): void {
    if (activeRoute.name !== 'browse') return;
    session.push({ ...activeRoute, groupKey });
  }

  function toggleLyricsView(): void {
    if (!lyricsAvailable) return;
    lyricsVisible = !lyricsVisible;
  }

  function handleNowPlayingControl(focusId: string): void {
    switch (focusId) {
      case ODA_NP_PLAY_PAUSE: commands.togglePlayback(); break;
      case ODA_NP_PREVIOUS: commands.stepTrack(-1); break;
      case ODA_NP_NEXT: commands.stepTrack(1); break;
      case ODA_NP_SHUFFLE: commands.toggleShuffle(); break;
      case ODA_NP_REPEAT: commands.cycleRepeat(); break;
      case ODA_NP_LYRICS: toggleLyricsView(); break;
    }
  }

  function handleFocusMove(focusId: string | null, direction: OdaDirection): boolean {
    if (activeRoute.name !== 'now-playing') return false;

    if (focusId === ODA_NP_VOLUME && (direction === 'up' || direction === 'down')) {
      handleVolumeStep(direction === 'up' ? 0.05 : -0.05);
      return true;
    }

    if ((focusId !== ODA_NP_PROGRESS && focusId !== ODA_THEATER_PROGRESS)
      || (direction !== 'left' && direction !== 'right')) {
      return false;
    }

    const current = playbackSnapshot?.currentTime ?? 0;
    const duration = playbackSnapshot?.duration ?? 0;
    const delta = direction === 'left' ? -ODA_NP_SEEK_STEP_SECONDS : ODA_NP_SEEK_STEP_SECONDS;
    commands.seek(duration > 0
      ? Math.min(Math.max(current + delta, 0), duration)
      : Math.max(current + delta, 0));
    return true;
  }

  function removeNowPlayingQueueItem(trackId: string): void {
    const nextFocusTrackId = resolveOdaNowPlayingRemovalTargetId(
      queueItems.map((item) => item.id),
      trackId
    );
    focus.setFocus(nextFocusTrackId
      ? odaTrackFocusId(nextFocusTrackId)
      : queueFlyoutOpen
        ? ODA_NP_QUEUE
        : defaultFocusId());
    commands.removeQueueTracks([trackId]);
  }

  function handleTheaterControl(focusId: string): void {
    switch (focusId) {
      case ODA_THEATER_PLAY_PAUSE: commands.togglePlayback(); break;
      case ODA_THEATER_PREVIOUS: commands.stepTrack(-1); break;
      case ODA_THEATER_NEXT: commands.stepTrack(1); break;
      case ODA_THEATER_FIT: commands.setVideoFit(media.fitMode === 'contain' ? 'cover' : 'contain'); break;
    }
  }

  function handleActivate(focusId: string | null): void {
    if (!focusId) return;

    if (activeRoute.name === 'home') {
      handleHomeActivate(focusId);
      return;
    }
    if (activeRoute.name === 'options') {
      if (focusId.startsWith('option:')) {
        selectOptionsView(focusId.slice('option:'.length) as OptionsViewName, focusId);
      }
      return;
    }
    if (activeRoute.name === 'now-playing') {
      if (focusId === ODA_NP_QUEUE) {
        toggleQueueFlyout();
        return;
      }
      const queueAction = parseOdaNowPlayingQueueActionFocusId(focusId);
      if (queueAction) {
        if (queueAction.action === 'move-up' && canReorderQueue) {
          commands.moveQueueTrack(queueAction.trackId, -1);
        } else if (queueAction.action === 'move-down' && canReorderQueue) {
          commands.moveQueueTrack(queueAction.trackId, 1);
        } else if (queueAction.action === 'remove' && canMutateQueue) {
          removeNowPlayingQueueItem(queueAction.trackId);
        }
        return;
      }
      if (queueFlyoutOpen) {
        void activateAndRoute(focusId, 'queue');
        return;
      }
      if (focusId.startsWith('np:')) {
        handleNowPlayingControl(focusId);
        return;
      }
      if (focusId.startsWith('th:')) handleTheaterControl(focusId);
      return;
    }
    if (activeRoute.name === 'browse') {
      const layout = odaBrowserLayoutFromFocusId(focusId);
      if (layout) {
        setBrowserLayout(layout);
        return;
      }
      const zoomDirection = odaBrowserZoomFromFocusId(focusId);
      if (zoomDirection) {
        adjustBrowserZoom(zoomDirection === 'in' ? 1 : -1);
        return;
      }
      const filter = odaBrowserFilterFromFocusId(focusId);
      if (filter) {
        session.setBrowseView(filter.medium, filter.view);
        return;
      }
      const groupKey = odaBrowseGroupKey(focusId);
      if (groupKey) {
        openBrowseGroup(groupKey);
        return;
      }
    }
    if (activeRoute.name === 'queue') {
      void activateAndRoute(focusId, 'queue');
      return;
    }
    if (activeRoute.name === 'browse' || activeRoute.name === 'recents') {
      void activateAndRoute(focusId, 'library');
    }
  }

  function selectOptionsView(view: OptionsViewName, focusId: string): void {
    optionsContentActive = true;
    lastOptionsFocusId = focusId;
    session.setOptionsView(view);
    focus.setFocus(null);
  }

  function handleBack(): void {
    if (queueFlyoutOpen) {
      closeQueueFlyout();
      return;
    }
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

  function handleVolumeStep(delta: number): void {
    commands.setVolume(Math.min(Math.max(playbackSnapshot.volume + delta, 0), 1));
  }

  function handleCardActivate(card: OdaCardModel): void {
    activateHomeCard(card);
  }

  function setBrowserLayout(layout: OdaBrowserLayout): void {
    if (activeRoute.name !== 'browse') return;
    if (layout === 'gallery' && activeRoute.medium === 'music') return;
    odaSettings.update({
      odaBrowserLayouts: {
        ...settings.odaBrowserLayouts,
        [activeRoute.medium]: layout
      }
    });
  }

  function adjustBrowserZoom(delta: -1 | 1): void {
    if (activeRoute.name !== 'browse') return;
    const medium = activeRoute.medium;
    const layout = settings.odaBrowserLayouts[medium];
    const current = settings.odaBrowserZoomLevels[medium][layout];
    const next = Math.min(Math.max(current + delta, 0), 4);
    if (next === current) return;
    odaSettings.update({
      odaBrowserZoomLevels: {
        ...settings.odaBrowserZoomLevels,
        [medium]: {
          ...settings.odaBrowserZoomLevels[medium],
          [layout]: next
        }
      }
    });
  }

  $: useRemoteBackground = multiplayer?.session.mode === 'client'
    && settings.odaUseHostBackground;
  $: requestedBackgroundImage = useRemoteBackground
    ? multiplayer?.session.remoteOdaBackground?.dataUrl ?? null
    : settings.odaBackground === 'custom' ? settings.odaBackgroundImage : null;
  $: requestedBackgroundOpacity = useRemoteBackground
    ? multiplayer?.session.remoteOdaBackground?.opacity ?? 0
    : settings.odaBackgroundOpacity;
  $: void prepareBackgroundImage(requestedBackgroundImage, requestedBackgroundOpacity);
</script>

<svelte:window
  on:pointerdown={handleScreensaverActivity}
  on:pointermove={handleScreensaverActivity}
  on:touchstart={handleScreensaverActivity}
  on:wheel={handleScreensaverActivity}
/>

<div
  class="oda-shell"
  style={`--oda-overscan-percent: ${settings.odaOverscanPercent}`}
  data-oda-active="true"
>
  {#if loadedBackgroundImage}
    <div
      class="oda-background"
      style={`background-image: url("${loadedBackgroundImage}"); opacity: ${loadedBackgroundOpacity}`}
      aria-hidden="true"
    ></div>
  {/if}
  <div class="oda-overscan">
    {#if activeRoute.name === 'home'}
      <OdaHome
        sections={homeSections}
        focusId={sessionState.focusId}
        {translate}
        {playingTrack}
        {playbackSnapshot}
        artworkUrl={playingTrack?.kind === 'stream' || playingTrack?.kind === 'module' ? artworkUrl : null}
        {queueItems}
        onActivate={handleCardActivate}
        onFocus={(focusId) => focus.setFocus(focusId)}
      />
    {:else if activeRoute.name === 'browse'}
      <OdaBrowseRoute
        medium={activeRoute.medium}
        view={activeRoute.view}
        items={activeRoute.medium === 'music'
          ? musicItems
          : activeRoute.medium === 'video'
            ? videoItems
            : imageItems}
        groupKey={activeRoute.groupKey ?? null}
        focusId={sessionState.focusId}
        playingId={playingTrack?.id ?? null}
        browserLayout={activeBrowserLayout}
        zoomLevel={activeBrowserZoomLevel}
        {translate}
        onActivateTrack={(id) => void activateAndRoute(odaTrackFocusId(id), 'library')}
        onOpenGroup={openBrowseGroup}
        onSelectView={(view) => session.setBrowseView(activeRoute.medium, view)}
        onSetBrowserLayout={setBrowserLayout}
        onAdjustZoom={adjustBrowserZoom}
        onFocus={(focusId) => focus.setFocus(focusId)}
      />
    {:else if activeRoute.name === 'recents'}
      <OdaListRoute
        title={translate('oda.cards.browseRecents', 'Browse recently played')}
        subtitle={translate('oda.browse.count', '{count} items', { count: recentsItems.length })}
        items={recentsItems}
        listKey="recents"
        focusId={sessionState.focusId}
        playingId={playingTrack?.id ?? null}
        emptyTitle={translate('oda.recents.emptyTitle', 'No recents')}
        emptyMessage={translate('oda.recents.empty', 'Nothing has been played yet.')}
        {translate}
        onActivate={(id) => void activateAndRoute(odaTrackFocusId(id), 'library')}
        onFocus={(focusId) => focus.setFocus(focusId)}
      />
    {:else if activeRoute.name === 'queue'}
      <OdaListRoute
        title={translate('oda.cards.queue', 'Queue')}
        subtitle={translate('oda.browse.count', '{count} items', { count: queueItems.length })}
        items={queueItems}
        listKey="queue"
        focusId={sessionState.focusId}
        playingId={playingTrack?.id ?? null}
        emptyTitle={translate('oda.queue.emptyTitle', 'The queue is empty')}
        emptyMessage={translate('oda.queue.empty', 'Add tracks from the library to build a queue.')}
        {translate}
        onActivate={(id) => void activateAndRoute(odaTrackFocusId(id), 'queue')}
        onFocus={(focusId) => focus.setFocus(focusId)}
      />
    {:else if activeRoute.name === 'now-playing'}
      {#if playingTrack?.kind === 'video'}
        <OdaVideoTheater
          track={playingTrack}
          element={media.videoElement}
          parkingHost={media.parkingHost}
          fitMode={media.fitMode}
          snapshot={playbackSnapshot}
          pictureInPictureSupported={media.pictureInPictureSupported}
          seekFeedback={media.seekFeedback}
          focusId={sessionState.focusId}
          {shuffleEnabled}
          {repeatMode}
          {translate}
          onTogglePlayback={commands.togglePlayback}
          onStepTrack={commands.stepTrack}
          onToggleShuffle={commands.toggleShuffle}
          onCycleRepeat={commands.cycleRepeat}
          onSeek={commands.seek}
          onVolumeStep={handleVolumeStep}
          onTogglePictureInPicture={commands.togglePictureInPicture}
          onSetFit={commands.setVideoFit}
          onToggleQueue={openQueueFlyout}
          onFocus={(focusId) => focus.setFocus(focusId)}
        />
      {:else if playingTrack?.kind === 'image'}
        <OdaImageTheater
          track={playingTrack}
          element={media.imageElement}
          parkingHost={media.parkingHost}
          fitMode={media.fitMode}
          zoom={media.imageZoom}
          focusId={sessionState.focusId}
          {shuffleEnabled}
          {repeatMode}
          {translate}
          onStepTrack={commands.stepTrack}
          onToggleShuffle={commands.toggleShuffle}
          onCycleRepeat={commands.cycleRepeat}
          onSetFit={commands.setVideoFit}
          onZoomStep={commands.zoomStep}
          onResetZoom={commands.resetZoom}
          onToggleQueue={openQueueFlyout}
          onFocus={(focusId) => focus.setFocus(focusId)}
        />
      {:else}
        <OdaNowPlaying
          track={playingTrack}
          snapshot={playbackSnapshot}
          {artworkUrl}
          focusId={sessionState.focusId}
          {shuffleEnabled}
          {repeatMode}
          {translate}
          hasLyrics={lyricsAvailable}
          lyricsOpen={lyricsOpen}
          onFocus={(focusId) => focus.setFocus(focusId)}
          onTogglePlayback={commands.togglePlayback}
          onStepTrack={commands.stepTrack}
          onSeek={commands.seek}
          onToggleShuffle={commands.toggleShuffle}
          onCycleRepeat={commands.cycleRepeat}
          onToggleQueue={openQueueFlyout}
          onToggleLyrics={toggleLyricsView}
        />
      {/if}

    {:else if activeRoute.name === 'options'}
      <OdaOptions
        groups={odaOptions.groups}
        auxiliaryViews={odaOptions.auxiliaryViews}
        activeView={activeRoute.view}
        focusId={sessionState.focusId}
        contentActive={optionsContentActive}
        {translate}
        advancedTweaksModified={settings.odaArrowRepeatInitialDelayMs !== DEFAULT_ODA_SETTINGS.odaArrowRepeatInitialDelayMs
          || settings.odaArrowRepeatIntervalMs !== DEFAULT_ODA_SETTINGS.odaArrowRepeatIntervalMs
          || settings.odaHoldBackAction !== DEFAULT_ODA_SETTINGS.odaHoldBackAction
          || settings.odaHoldBackThresholdMs !== DEFAULT_ODA_SETTINGS.odaHoldBackThresholdMs
          || settings.odaScreensaverMoveIntervalMinutes !== DEFAULT_ODA_SETTINGS.odaScreensaverMoveIntervalMinutes}
        onFocus={(focusId) => focus.setFocus(focusId)}
        onSelectView={(view) => selectOptionsView(view, odaOptionsCategoryFocusId(view))}
      />
    {/if}
  </div>

  {#if activeRoute.name === 'now-playing' && queueFlyoutOpen}
    <OdaQueueFlyout
      items={queueItems}
      playingId={playingTrack?.id ?? null}
      focusId={sessionState.focusId}
      canMutate={canMutateQueue}
      canReorder={canReorderQueue}
      {translate}
      onClose={closeQueueFlyout}
      onActivate={(id) => void activateAndRoute(odaTrackFocusId(id), 'queue')}
      onFocus={(focusId) => focus.setFocus(focusId)}
      onRemove={removeNowPlayingQueueItem}
      onMove={(id, direction) => commands.moveQueueTrack(id, direction)}
    />
  {/if}

  {#if !(activeRoute.name === 'now-playing' && (playingTrack?.kind === 'video' || playingTrack?.kind === 'image'))}
    <OdaTopChrome />

    <div class="oda-version" aria-hidden="true"><strong>izci</strong> {appVersion}</div>
  {/if}

  <OdaScreensaver
    active={screensaverActive}
    {imageItems}
    {playingTrack}
    moveIntervalMinutes={settings.odaScreensaverMoveIntervalMinutes}
  />

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
</div>
