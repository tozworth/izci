<script lang="ts">
  import type { OdaSettings, PlaybackSnapshot, RepeatMode, TrackItem } from '$lib/types';
  import type { OdaRoute, OdaSession, OdaSessionSnapshot } from '$lib/services/oda-session';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import { IMAGE_ZOOM_WHEEL_FACTOR } from '$lib/stores/video-settings';
  import { DEFAULT_ODA_SETTINGS } from '$lib/stores/oda-settings';
  import type { OptionsViewName } from '../options/views';
  import OdaBrowseRoute from './views/OdaBrowseRoute.svelte';
  import OdaHome from './views/OdaHome.svelte';
  import OdaImageTheater from './views/OdaImageTheater.svelte';
  import OdaListRoute from './views/OdaListRoute.svelte';
  import OdaNowPlaying from './views/OdaNowPlaying.svelte';
  import OdaOptions from './views/OdaOptions.svelte';
  import OdaTopChrome from './OdaTopChrome.svelte';
  import { version as appVersion } from '../../package.json';
  import OdaVideoTheater from './views/OdaVideoTheater.svelte';
  import type { OdaCommands, OdaMediaHost } from './oda-commands';
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
    isOdaGroupedBrowseView,
    odaBrowseGroupKey,
    odaBrowseTrackId,
    odaTrackFocusId,
    resolveOdaBrowseGroup
  } from './oda-browse';
  import {
    findWaterfallFocus,
    waterfallCardFocusId,
    type OdaWaterfallSection
  } from './oda-navigation';
  import type { OdaFocusController, OdaTransportAction } from './oda-focus';
  import {
    ODA_NP_NEXT,
    ODA_NP_PLAY_PAUSE,
    ODA_NP_PREVIOUS,
    ODA_NP_REPEAT,
    ODA_NP_SEEK_BACK,
    ODA_NP_SEEK_FORWARD,
    ODA_NP_SEEK_STEP_SECONDS,
    ODA_NP_SHUFFLE
  } from './oda-now-playing';
  import {
    ODA_THEATER_BACK,
    ODA_THEATER_FIT,
    ODA_THEATER_NEXT,
    ODA_THEATER_PLAY_PAUSE,
    ODA_THEATER_PREVIOUS,
    ODA_THEATER_ROTATE,
    ODA_THEATER_SEEK_BACK,
    ODA_THEATER_SEEK_FORWARD,
    ODA_THEATER_ZOOM_IN,
    ODA_THEATER_ZOOM_OUT,
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

  // Precompute the active route's focus IDs so per-keypress validation is a
  // cheap membership check instead of a full library regrouping.
  let routeFocusIds: string[] = [];
  $: {
    void libraryItems;
    void queueItems;
    void optionCategoryIds;
    routeFocusIds = resolveOdaRouteFocusIds(activeRoute, focusContext());
  }

  function focusContext(): OdaRouteFocusContext {
    return {
      musicItems,
      videoItems,
      imageItems,
      recentsItems,
      queueItems,
      optionCategoryIds,
      homeWaterfallSections
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
    focus.setModel(optionsContentActive ? null : resolveRouteModel(activeRoute));
  }

  // If the focused item disappears (queue removal, metadata refresh, group
  // change) fall back to a deliberate default instead of a stale ID.
  $: {
    void libraryItems;
    void queueItems;
    void homeWaterfallSections;
    void optionCategoryIds;
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
    if (track.kind === 'video') {
      session.push({ name: 'video-theater' });
      return;
    }
    if (track.kind === 'image') {
      session.push({ name: 'image-theater' });
      return;
    }
    session.push({ name: 'now-playing' });
  }

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

  function openBrowseGroup(groupKey: string): void {
    if (activeRoute.name !== 'browse') return;
    session.push({ ...activeRoute, groupKey });
  }

  function handleNowPlayingControl(focusId: string): void {
    const current = playbackSnapshot?.currentTime ?? 0;
    const duration = playbackSnapshot?.duration ?? 0;
    switch (focusId) {
      case ODA_NP_PLAY_PAUSE: commands.togglePlayback(); break;
      case ODA_NP_PREVIOUS: commands.stepTrack(-1); break;
      case ODA_NP_NEXT: commands.stepTrack(1); break;
      case ODA_NP_SHUFFLE: commands.toggleShuffle(); break;
      case ODA_NP_REPEAT: commands.cycleRepeat(); break;
      case ODA_NP_SEEK_BACK: commands.seek(Math.max(current - ODA_NP_SEEK_STEP_SECONDS, 0)); break;
      case ODA_NP_SEEK_FORWARD:
        commands.seek(duration > 0
          ? Math.min(current + ODA_NP_SEEK_STEP_SECONDS, duration)
          : current + ODA_NP_SEEK_STEP_SECONDS);
        break;
    }
  }

  function handleTheaterControl(focusId: string): void {
    const current = playbackSnapshot?.currentTime ?? 0;
    const duration = playbackSnapshot?.duration ?? 0;
    switch (focusId) {
      case ODA_THEATER_PLAY_PAUSE: commands.togglePlayback(); break;
      case ODA_THEATER_PREVIOUS: commands.stepTrack(-1); break;
      case ODA_THEATER_NEXT: commands.stepTrack(1); break;
      case ODA_THEATER_SEEK_BACK: commands.seek(Math.max(current - ODA_THEATER_SEEK_STEP_SECONDS, 0)); break;
      case ODA_THEATER_SEEK_FORWARD:
        commands.seek(duration > 0
          ? Math.min(current + ODA_THEATER_SEEK_STEP_SECONDS, duration)
          : current + ODA_THEATER_SEEK_STEP_SECONDS);
        break;
      case ODA_THEATER_FIT: commands.setVideoFit(media.fitMode === 'contain' ? 'cover' : 'contain'); break;
      case ODA_THEATER_ZOOM_IN: commands.zoomStep(IMAGE_ZOOM_WHEEL_FACTOR); break;
      case ODA_THEATER_ZOOM_OUT: commands.zoomStep(1 / IMAGE_ZOOM_WHEEL_FACTOR); break;
      case ODA_THEATER_ROTATE: commands.rotateImage(); break;
      case ODA_THEATER_BACK: session.back(); break;
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
      if (focusId.startsWith('np:')) {
        handleNowPlayingControl(focusId);
        return;
      }
      void activateAndRoute(focusId, 'queue');
      return;
    }
    if (activeRoute.name === 'video-theater' || activeRoute.name === 'image-theater') {
      if (focusId.startsWith('th:')) handleTheaterControl(focusId);
      return;
    }
    if (activeRoute.name === 'browse') {
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
    if (route.groupKey && isOdaGroupedBrowseView(route.view)) {
      const group = resolveOdaBrowseGroup(musicItems, route.view, route.groupKey);
      if (group) return group.label;
    }
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

  function browseSubtitle(route: Extract<OdaRoute, { name: 'browse' }>): string {
    const count = routeFocusIds.length;
    const isGroupLevel = route.medium === 'music'
      && isOdaGroupedBrowseView(route.view)
      && !route.groupKey;
    return isGroupLevel
      ? translate('oda.browse.groupCount', '{count} groups', { count })
      : translate('oda.browse.count', '{count} items', { count });
  }

  function handleVolumeStep(delta: number): void {
    commands.setVolume(Math.min(Math.max(playbackSnapshot.volume + delta, 0), 1));
  }

  function handleCardActivate(card: OdaCardModel): void {
    activateHomeCard(card);
  }

  $: odaBackgroundVisible = settings.odaBackground === 'custom' && settings.odaBackgroundImage;
  $: odaBackgroundOpacity = Math.min(Math.max(settings.odaBackgroundOpacity, 0), 100) / 100;
</script>

<div
  class="oda-shell"
  style={`--oda-overscan-percent: ${settings.odaOverscanPercent}`}
  data-oda-active="true"
>
  {#if odaBackgroundVisible}
    <div
      class="oda-background"
      style={`background-image: url("${settings.odaBackgroundImage}"); opacity: ${odaBackgroundOpacity}`}
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
        {artworkUrl}
        queueCount={queueItems.length}
        onActivate={handleCardActivate}
        onFocus={(focusId) => focus.setFocus(focusId)}
      />
    {:else if activeRoute.name === 'browse'}
      <OdaBrowseRoute
        view={activeRoute.view}
        items={activeRoute.medium === 'music'
          ? musicItems
          : activeRoute.medium === 'video'
            ? videoItems
            : imageItems}
        groupKey={activeRoute.groupKey ?? null}
        title={browseTitle(activeRoute)}
        subtitle={browseSubtitle(activeRoute)}
        focusId={sessionState.focusId}
        playingId={playingTrack?.id ?? null}
        {translate}
        onActivateTrack={(id) => void activateAndRoute(odaTrackFocusId(id), 'library')}
        onOpenGroup={openBrowseGroup}
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
      <OdaNowPlaying
        track={playingTrack}
        snapshot={playbackSnapshot}
        {artworkUrl}
        {queueItems}
        focusId={sessionState.focusId}
        {shuffleEnabled}
        {repeatMode}
        {canMutateQueue}
        {canReorderQueue}
        {translate}
        onActivateQueueItem={(id) => void activateAndRoute(odaTrackFocusId(id), 'queue')}
        onFocus={(focusId) => focus.setFocus(focusId)}
        onTogglePlayback={commands.togglePlayback}
        onStepTrack={commands.stepTrack}
        onSeek={commands.seek}
        onToggleShuffle={commands.toggleShuffle}
        onCycleRepeat={commands.cycleRepeat}
        onRemoveQueueItem={(id) => commands.removeQueueTracks([id])}
        onMoveQueueItem={(id, direction) => commands.moveQueueTrack(id, direction)}
      />
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
          || settings.odaHoldBackThresholdMs !== DEFAULT_ODA_SETTINGS.odaHoldBackThresholdMs}
        onFocus={(focusId) => focus.setFocus(focusId)}
        onSelectView={(view) => selectOptionsView(view, odaOptionsCategoryFocusId(view))}
      />
    {:else if activeRoute.name === 'video-theater'}
      <OdaVideoTheater
        element={media.videoElement}
        parkingHost={media.parkingHost}
        fitMode={media.fitMode}
        snapshot={playbackSnapshot}
        pictureInPictureSupported={media.pictureInPictureSupported}
        seekFeedback={media.seekFeedback}
        focusId={sessionState.focusId}
        {translate}
        onTogglePlayback={commands.togglePlayback}
        onStepTrack={commands.stepTrack}
        onSeek={commands.seek}
        onVolumeStep={handleVolumeStep}
        onTogglePictureInPicture={commands.togglePictureInPicture}
        onSetFit={commands.setVideoFit}
        onZoomStep={commands.zoomStep}
        onRotateImage={commands.rotateImage}
        onBack={() => session.back()}
      />
    {:else if activeRoute.name === 'image-theater'}
      <OdaImageTheater
        element={media.imageElement}
        parkingHost={media.parkingHost}
        fitMode={media.fitMode}
        zoom={media.imageZoom}
        focusId={sessionState.focusId}
        {translate}
        onTogglePlayback={commands.togglePlayback}
        onStepTrack={commands.stepTrack}
        onSetFit={commands.setVideoFit}
        onZoomStep={commands.zoomStep}
        onResetZoom={commands.resetZoom}
        onRotateImage={commands.rotateImage}
        onBack={() => session.back()}
      />
    {/if}
  </div>

  <OdaTopChrome />

  <div class="oda-version" aria-hidden="true"><strong>izci</strong> {appVersion}</div>

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
