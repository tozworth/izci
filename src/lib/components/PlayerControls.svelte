<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    extractArtworkPalette,
    type PlayerArtworkColorSet,
    type PlayerArtworkPalette
  } from '$lib/services/artwork-palette';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import { sessionIdlePlayerQuip, type IdlePlayerQuipId } from '$lib/services/idle-player-copy';
  import { createWheelSeekController } from '$lib/services/wheel-seek';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import RatingPicker from '$lib/components/RatingPicker.svelte';
  import {
    addPlaybackBookmark,
    deletePlaybackBookmark,
    getPlaybackBookmarkFileKey,
    getPlaybackBookmarks,
    type PlaybackBookmark
  } from '$lib/services/playback-bookmarks';
  import { portal } from '$lib/components/track-list-panel/actions/portal';
  import { windowDismiss } from '$lib/components/track-list-panel/actions/window-dismiss';
  import {
    appearanceSettings,
    hasArtworkBackdrop,
    hasVisualizerBackdrop,
    toBackdropZoneArtworkStyle
  } from '$lib/stores/appearance-settings';
  import type { Readable } from 'svelte/store';
  import { formatDuration, getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';
  import type {
    BackdropZoneArtworkSettings,
    BackdropZoneEffect,
    MenuActionItem,
    PlaybackSnapshot,
    TrackItem,
    RafPreset
  } from '$lib/types';

  function localizeIdlePlayerQuip(quip: IdlePlayerQuipId): string {
    switch (quip) {
      case 'scout': return $t('main.player.quips.scout', { default: 'İzci means scout. Tracker was already taken.' });
      case 'xmplayRam': return $t('main.player.quips.xmplayRam', { default: 'What if XMPlay used 9 GB of RAM?' });
      case 'interpolation': return $t('main.player.quips.interpolation', { default: 'REAL modheads turn interpolation OFF' });
      case 'lrcMsn': return $t('main.player.quips.lrcMsn', { default: 'Time-synced LRC display! (MSN integration coming soon.)' });
      case 'fourChannels': return $t('main.player.quips.fourChannels', { default: 'Four channels ought to be enough for anybody.' });
      case 'diskTwo': return $t('main.player.quips.diskTwo', { default: 'Please insert disk 2.' });
      case 'playsThat': return $t('main.player.quips.playsThat', { default: 'Yes, it plays that too.' });
      case 'opusEyes': return $t('main.player.quips.opusEyes', { default: "Your eyes can't smell past 160k Opus anyway." });
      case 'velocidensity': return $t('main.player.quips.velocidensity', { default: 'Maximum rotational velocidensity achieved.' });
      case 'santaFlac': return $t('main.player.quips.santaFlac', { default: 'Do you believe in Santa, the Tooth Fairy, or FLAC?' });
      case 'stereoMind': return $t('main.player.quips.stereoMind', { default: 'Stereo separation is a state of mind.' });
      case 'offlineAmiga': return $t('main.player.quips.offlineAmiga', { default: 'Works offline. So did your Amiga.' });
      case 'youtubeRips': return $t('main.player.quips.youtubeRips', { default: 'Does not support YouTube MP3 rips.' });
      case 'winampPlugins': return $t('main.player.quips.winampPlugins', { default: 'Does not support Winamp plugins.' });
      case 'goldPlatedEars': return $t('main.player.quips.goldPlatedEars', { default: 'Lossless gold-plated ears sold separately.' });
      case 'pronunciation': return $t('main.player.quips.pronunciation', { default: "It's pronounced eez-jee." });
      case 'losslessSilence': return $t('main.player.quips.losslessSilence', { default: 'This silence is lossless.' });
      case 'llama': return $t('main.player.quips.llama', { default: 'Whips the llama respectfully.' });
      case 'patternZero': return $t('main.player.quips.patternZero', { default: 'Pattern 00, Row 00, Order 00.' });
      case 'whatPwa': return $t('main.player.quips.whatPwa', { default: 'What even is a PWA?' });
      case 'worksOnMachine': return $t('main.player.quips.worksOnMachine', { default: 'Works on my machine.' });
    }
  }

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let track: TrackItem | null = null;
  export let selectedTrack: TrackItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundBright = false;
  export let backdropEffect: BackdropZoneEffect = 'visualizer';
  export let backdropArtworkSettings: BackdropZoneArtworkSettings | null = null;
  export let presentation: 'bar' | 'now-playing' | 'theater' = 'bar';
  export let useArtworkColorsOverride: boolean | null = null;
  export let artworkColorSurfaceBright = false;
  export let hasCollectionItems = false;
  export let collectionsReady = true;
  export let showFavoriteToggle = false;
  export let favorite = false;
  export let ratingsEnabled = false;
  export let rating = 0;
  export let showRafToggle = false;
  export let rafEnabled = true;
  export let rafPresets: RafPreset[] = [];
  export let selectedRafPresetId: string | null = null;
  export let rafPresetDirty = false;
  export let showVideoTheaterToggle = false;
  export let imageMode = false;
  export let videoTheaterActive = false;
  export let videoFullscreenActive = false;

  const dispatch = createEventDispatcher<{
    toggle: void;
    previous: void;
    next: void;
    previousSubsong: void;
    nextSubsong: void;
    seek: number;
    volume: number;
    mute: void;
    toggleFavorite: void;
    rate: number | undefined;
    toggleRaf: void;
    applyRafPreset: string;
    openRafOptions: void;
    showTrack: string;
    toggleVideoTheater: void;
    enterNowPlaying: void;
  }>();

  const COMPACT_VOLUME_QUERY = '(max-width: 349px)';
  const COMPACT_VOLUME_OPEN_DELAY_MS = 120;
  const RANGE_THUMB_SIZE_REM = 1.05;
  const PLAYER_BAR_RESERVE_PROPERTY = '--player-bar-measured-reserve';
  const THEATER_PLAYER_BAR_HEIGHT_PROPERTY = '--video-theater-player-height';
  let playerBarElement: HTMLElement | null = null;
  let favoriteToggleElement: HTMLButtonElement | null = null;
  let ratingPickerX = 0;
  let ratingPickerY = 0;
  let playerBarResizeObserver: ResizeObserver | null = null;
  let playerBarReserveFrame: number | null = null;
  let viewportUsesCompactVolume = false;
  let isCompactVolume = false;
  let isVolumePopupOpen = false;
  let volumePopupTimer: number | null = null;
  let playerArtworkPalette: PlayerArtworkPalette | null = null;
  let playerArtworkPaletteUrl: string | undefined = undefined;
  let playerArtworkPaletteToken = 0;
  let rafPresetMenuOpen = false;
  let rafPresetMenuX = 0;
  let rafPresetMenuY = 0;
  let rafPresetMenuElement: HTMLDivElement | null = null;
  let bookmarkMenuOpen = false;
  let bookmarkMenuX = 0;
  let bookmarkMenuY = 0;
  let bookmarks: PlaybackBookmark[] = [];
  let loadedBookmarkTrackKey: string | null = null;
  let seekPreview = 0;
  let seekPointerActive = false;
  let seekWheelActive = false;
  let snapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0,
    muted: false,
    backend: null,
    error: undefined
  };
  $: containerElement = presentation === 'now-playing' ? 'section' : 'footer';
  $: videoTheaterToggleLabel = videoFullscreenActive
    ? $t('main.player.exitFullscreen', { default: 'Exit fullscreen' })
    : videoTheaterActive
      ? imageMode
        ? $t('main.player.exitImageTheater', { default: 'Exit image theater' })
        : $t('main.player.exitVideoTheater', { default: 'Exit video theater' })
      : imageMode
        ? $t('main.player.enterImageTheater', { default: 'Enter image theater' })
        : $t('main.player.enterVideoTheater', { default: 'Enter video theater' });

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function positionRatingPicker() {
    if (!favoriteToggleElement || typeof window === 'undefined') return;
    const bounds = favoriteToggleElement.getBoundingClientRect();
    ratingPickerX = clamp(bounds.left + bounds.width / 2, 58, window.innerWidth - 58);
    ratingPickerY = bounds.top;
  }

  function handleSeekWheel(event: WheelEvent) {
    wheelSeek.step(event.deltaY);
  }

  const wheelSeek = createWheelSeekController({
    getCurrentTime: () => snapshot.currentTime,
    getDuration: () => snapshot.duration,
    getContextKey: () => track?.id ?? null,
    onPreview: (seconds) => {
      seekWheelActive = seconds !== null;
      if (seconds !== null) seekPreview = seconds;
    },
    onCommit: (seconds) => dispatch('seek', seconds)
  });

  function beginSeekPointer(event: PointerEvent): void {
    // A secondary click on the seek control is for the player context menu,
    // not the beginning of a seek gesture. Treating it as a drag can make the
    // range input commit a tiny position change when the menu opens.
    if (event.button !== 0) {
      event.preventDefault();
      return;
    }
    wheelSeek.cancel();
    seekPointerActive = true;
    seekPreview = snapshot.currentTime;
  }

  function previewSeek(event: Event): void {
    const seconds = Number((event.currentTarget as HTMLInputElement).value);
    seekPreview = seconds;

    // Keyboard changes are discrete, so apply them immediately. Pointer drags
    // commit once on release to avoid backend progress updates fighting the thumb.
    if (!seekPointerActive) {
      wheelSeek.cancel();
      dispatch('seek', seconds);
    }
  }

  function commitSeekPointer(event: PointerEvent): void {
    if (event.button !== 0 || !seekPointerActive) {
      return;
    }

    const seconds = Number((event.currentTarget as HTMLInputElement).value);
    seekPreview = seconds;
    seekPointerActive = false;
    dispatch('seek', seconds);
  }

  function cancelSeekPointer(): void {
    seekPointerActive = false;
    seekPreview = snapshot.currentTime;
  }

  onDestroy(wheelSeek.cancel);

  function handleVolumeWheel(event: WheelEvent) {
    if (snapshot.muted) {
      return;
    }

    const delta = event.deltaY < 0 ? 1 : -1;
    dispatch('volume', clamp(snapshot.volume + delta * 0.05, 0, 1));
  }

  function clearVolumePopupTimer() {
    if (volumePopupTimer !== null) {
      window.clearTimeout(volumePopupTimer);
      volumePopupTimer = null;
    }
  }

  function openVolumePopup() {
    if (!isCompactVolume) {
      return;
    }

    clearVolumePopupTimer();
    volumePopupTimer = window.setTimeout(() => {
      isVolumePopupOpen = true;
      volumePopupTimer = null;
    }, COMPACT_VOLUME_OPEN_DELAY_MS);
  }

  function closeVolumePopup() {
    clearVolumePopupTimer();
    isVolumePopupOpen = false;
  }

  async function openRafPresetMenu(event: MouseEvent) {
    const anchor = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
    const estimatedHeight = Math.min(320, 45 + Math.max(rafPresets.length, 1) * 30);
    rafPresetMenuX = clamp(anchor.right - 192, 6, Math.max(6, window.innerWidth - 198));
    rafPresetMenuY = Math.max(6, anchor.top - estimatedHeight - 4);
    rafPresetMenuOpen = true;
    await tick();

    if (!rafPresetMenuOpen || !rafPresetMenuElement) return;
    rafPresetMenuX = clamp(
      anchor.right - rafPresetMenuElement.offsetWidth,
      6,
      Math.max(6, window.innerWidth - rafPresetMenuElement.offsetWidth - 6)
    );
    rafPresetMenuY = Math.max(6, anchor.top - rafPresetMenuElement.offsetHeight - 4);
  }

  function closeRafPresetMenu() {
    rafPresetMenuOpen = false;
  }

  function openBookmarkMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    bookmarkMenuX = event.clientX;
    bookmarkMenuY = event.clientY;
    bookmarkMenuOpen = true;
  }

  function handleBookmarkAction(action: string): void {
    if (!track) return;
    if (action === 'bookmark:add') {
      const name = window.prompt($t('main.player.bookmarkNamePrompt', { default: 'Name this bookmark:' }));
      if (name === null) return;
      bookmarks = addPlaybackBookmark(track, snapshot.currentTime, name);
      return;
    }
    if (action.startsWith('bookmark:delete:')) {
      bookmarks = deletePlaybackBookmark(track, action.slice('bookmark:delete:'.length));
      return;
    }
    if (action.startsWith('bookmark:seek:')) {
      const bookmark = bookmarks.find(({ id }) => id === action.slice('bookmark:seek:'.length));
      if (bookmark) dispatch('seek', bookmark.time);
    }
  }

  function applyRafPreset(id: string) {
    dispatch('applyRafPreset', id);
    closeRafPresetMenu();
  }

  async function syncPlayerArtworkPalette(url: string | undefined): Promise<void> {
    const token = ++playerArtworkPaletteToken;
    playerArtworkPaletteUrl = url;

    if (!url) {
      playerArtworkPalette = null;
      return;
    }

    try {
      const palette = await extractArtworkPalette(url);

      if (token === playerArtworkPaletteToken && playerArtworkPaletteUrl === url) {
        playerArtworkPalette = palette.player;
      }
    } catch {
      if (token === playerArtworkPaletteToken) {
        playerArtworkPalette = null;
      }
    }
  }

  function toPlayerArtworkStyle(palette: PlayerArtworkColorSet | null): string {
    if (!palette) {
      return '';
    }

    return [
      `--text: ${palette.text}`,
      `--text-strong: ${palette.textStrong}`,
      `--muted: ${palette.muted}`,
      `--player-control-accent: ${palette.rangeFill}`,
      `--player-range-fill: ${palette.rangeFill}`,
      `--player-range-track: ${palette.rangeTrack}`,
      `--player-range-border: ${palette.rangeBorder}`,
      `--player-range-thumb: ${palette.rangeThumb}`
    ].join('; ');
  }

  function toRangeProgressStyle(value: number, max: number): string {
    const percent = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
    let fillEnd = '0px';

    if (percent >= 100) {
      fillEnd = '100%';
    } else if (percent > 0) {
      const thumbCenterOffsetRem = RANGE_THUMB_SIZE_REM * (0.5 - percent / 100);
      const offsetSign = thumbCenterOffsetRem < 0 ? '-' : '+';
      fillEnd = `calc(${percent}% ${offsetSign} ${Math.abs(thumbCenterOffsetRem).toFixed(4)}rem)`;
    }

    return `--player-range-progress: ${percent}%; --player-range-fill-end: ${fillEnd};`;
  }

  function toBufferedRangeStyle(start: number, end: number, max: number): string {
    if (max <= 0 || end <= start) {
      return 'display: none;';
    }

    const left = clamp((start / max) * 100, 0, 100);
    const width = clamp(((end - start) / max) * 100, 0, 100 - left);
    return `left: ${left}%; width: ${width}%;`;
  }

  function getVolumeIcon(volume: number, muted: boolean): string {
    if (muted || volume <= 0) {
      return 'volume_off';
    }

    return volume < 0.5 ? 'volume_down' : 'volume_up';
  }

  function getAppShell(): HTMLElement | null {
    return playerBarElement?.closest('.app-shell') as HTMLElement | null;
  }

  function clearPlayerBarReserve() {
    getAppShell()?.style.removeProperty(PLAYER_BAR_RESERVE_PROPERTY);
  }

  function clearTheaterPlayerBarHeight() {
    getAppShell()?.style.removeProperty(THEATER_PLAYER_BAR_HEIGHT_PROPERTY);
  }

  function syncPlayerBarReserve() {
    playerBarReserveFrame = null;

    if (presentation === 'now-playing') {
      clearPlayerBarReserve();
      clearTheaterPlayerBarHeight();
      return;
    }

    if (!playerBarElement) {
      clearPlayerBarReserve();
      clearTheaterPlayerBarHeight();
      return;
    }

    const height = Math.ceil(playerBarElement.getBoundingClientRect().height);

    if (height <= 0) {
      clearPlayerBarReserve();
      clearTheaterPlayerBarHeight();
      return;
    }

    const appShell = getAppShell();
    if (presentation === 'theater') {
      appShell?.style.removeProperty(PLAYER_BAR_RESERVE_PROPERTY);
      appShell?.style.setProperty(THEATER_PLAYER_BAR_HEIGHT_PROPERTY, `${height}px`);
      return;
    }

    appShell?.style.removeProperty(THEATER_PLAYER_BAR_HEIGHT_PROPERTY);
    appShell?.style.setProperty(PLAYER_BAR_RESERVE_PROPERTY, `${height}px`);
  }

  function schedulePlayerBarReserveSync() {
    if (typeof window === 'undefined' || playerBarReserveFrame !== null) {
      return;
    }

    playerBarReserveFrame = window.requestAnimationFrame(syncPlayerBarReserve);
  }

  onMount(() => {
    const mediaQuery = window.matchMedia(COMPACT_VOLUME_QUERY);

    const syncCompactVolume = () => {
      viewportUsesCompactVolume = mediaQuery.matches;
      closeVolumePopup();
    };

    syncCompactVolume();
    mediaQuery.addEventListener('change', syncCompactVolume);
    schedulePlayerBarReserveSync();

    if (typeof ResizeObserver !== 'undefined' && playerBarElement) {
      playerBarResizeObserver = new ResizeObserver(schedulePlayerBarReserveSync);
      playerBarResizeObserver.observe(playerBarElement);
    }

    return () => {
      closeVolumePopup();
      mediaQuery.removeEventListener('change', syncCompactVolume);
      playerBarResizeObserver?.disconnect();
      playerBarResizeObserver = null;

      if (playerBarReserveFrame !== null) {
        window.cancelAnimationFrame(playerBarReserveFrame);
        playerBarReserveFrame = null;
      }

      clearPlayerBarReserve();
      clearTheaterPlayerBarHeight();
    };
  });

  $: snapshot = $snapshotStore;
  $: isLoading = snapshot.state === 'loading';
  $: if (!seekPointerActive && !seekWheelActive) seekPreview = snapshot.currentTime;
  $: displayedSeekTime = seekPointerActive || seekWheelActive ? seekPreview : snapshot.currentTime;
  $: compactPlayerBar = presentation !== 'now-playing' && $appearanceSettings.compactPlayerBar;
  $: isCompactVolume = viewportUsesCompactVolume || compactPlayerBar;
  $: displayTrack = track;
  $: displayDuration = track ? snapshot.duration : 0;
  $: bookmarkTrackKey = track ? getPlaybackBookmarkFileKey(track) : null;
  $: if (bookmarkTrackKey !== loadedBookmarkTrackKey) {
    loadedBookmarkTrackKey = bookmarkTrackKey;
    bookmarks = track ? getPlaybackBookmarks(track) : [];
    bookmarkMenuOpen = false;
  }
  $: bookmarkMenuItems = [{
    id: 'bookmarks',
    label: $t('main.player.bookmarks', { default: 'Bookmarks' }),
    icon: 'bookmarks',
    disabled: !track,
    children: [
      ...bookmarks.map((bookmark): MenuActionItem => ({
        id: `bookmark:seek:${bookmark.id}`,
        label: bookmark.name,
        shortcut: formatDuration(bookmark.time),
        icon: 'bookmark',
        removeActionId: `bookmark:delete:${bookmark.id}`,
        removeLabel: $t('main.player.deleteBookmark', {
          default: 'Delete bookmark {name}',
          values: { name: bookmark.name }
        })
      })),
      {
        id: 'bookmark:add',
        label: $t('main.player.addBookmark', { default: 'Add bookmark' }),
        icon: 'bookmark_add',
        separatorBefore: bookmarks.length > 0
      }
    ]
  } satisfies MenuActionItem];
  $: displaySubsongCount = displayTrack?.kind === 'module'
    ? Math.max(snapshot.subsongCount ?? displayTrack.metadata?.subsongs ?? 1, 1)
    : 1;
  $: displaySubsong = displayTrack?.kind === 'module'
    ? Math.min(Math.max(snapshot.subsong ?? displayTrack.subsong ?? 0, 0), displaySubsongCount - 1)
    : 0;
  $: artworkBackgroundActive = hasArtworkBackdrop(backdropEffect) && Boolean(artwork);
  $: visualizerBackdropActive = hasVisualizerBackdrop(backdropEffect);
  $: if (
    presentation &&
    compactPlayerBar !== undefined &&
    artworkBackgroundActive !== undefined &&
    visualizerBackdropActive !== undefined
  ) {
    schedulePlayerBarReserveSync();
  }
  $: playerArtworkPaletteActive =
    (useArtworkColorsOverride ?? $appearanceSettings.useArtworkPlayerColors) &&
    artwork !== null &&
    playerArtworkPalette !== null;
  $: playerArtworkColors = (artworkColorSurfaceBright || (artworkBackgroundActive && artworkBackgroundBright))
    ? playerArtworkPalette?.onLightBackground ?? null
    : playerArtworkPalette;
  $: playerArtworkStyle = playerArtworkPaletteActive
    ? toPlayerArtworkStyle(playerArtworkColors)
    : '';
  $: backdropArtworkStyle = backdropArtworkSettings
    ? toBackdropZoneArtworkStyle(backdropArtworkSettings)
    : '';
  $: rootStyle = [backdropArtworkStyle, playerArtworkStyle].filter(Boolean).join('; ');
  $: if (artwork?.url !== playerArtworkPaletteUrl) {
    void syncPlayerArtworkPalette(artwork?.url);
  }
  $: if (presentation !== 'bar') {
    clearPlayerBarReserve();
  }

  function handleShowTrack() {
    if (!displayTrack) {
      return;
    }

    dispatch('showTrack', displayTrack.id);
  }

  function handleSubsongStep(event: MouseEvent, direction: -1 | 1): void {
    if (!displayTrack || displayTrack.kind !== 'module' || displaySubsongCount <= 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (direction < 0) {
      dispatch('previousSubsong');
    } else {
      dispatch('nextSubsong');
    }
  }
</script>

<svelte:element
  this={containerElement}
  bind:this={playerBarElement}
  class="player-bar"
  class:now-playing-player={presentation === 'now-playing'}
  class:theater-player-bar={presentation === 'theater'}
  class:compact-player-bar={compactPlayerBar}
  class:loading={isLoading}
  class:video-track-active={displayTrack?.kind === 'video'}
  class:image-track-active={imageMode}
  class:artwork-background-active={artworkBackgroundActive}
  class:artwork-background-bright={artworkBackgroundActive && artworkBackgroundBright}
  class:visualizer-backdrop-active={visualizerBackdropActive}
  aria-label={presentation === 'now-playing'
    ? $t('main.player.nowPlayingControls', { default: 'Now Playing controls' })
    : presentation === 'theater'
      ? imageMode
        ? $t('main.player.imageTheaterControls', { default: 'Image theater controls' })
        : $t('main.player.videoTheaterControls', { default: 'Video theater controls' })
      : undefined}
  data-artwork-zone={artworkBackgroundActive ? 'true' : null}
  data-visualizer-zone={visualizerBackdropActive ? 'true' : null}
  data-backdrop-zone-id={presentation === 'bar' ? 'player' : null}
  style={rootStyle}
>
  <div class="player-track-group">
    {#if displayTrack?.kind !== 'video' && displayTrack?.kind !== 'image'}
      <button
        type="button"
        class="player-artwork-button"
        class:now-playing-entry={presentation !== 'now-playing'}
        aria-label={presentation === 'now-playing'
          ? $t('main.player.showCurrentTrackDetails', { default: 'Show current track details' })
          : $t('main.player.enterNowPlaying', { default: 'Enter Now Playing' })}
        disabled={!displayTrack}
        on:click={presentation === 'now-playing'
          ? handleShowTrack
          : () => dispatch('enterNowPlaying')}
      >
        <div class="player-artwork" aria-hidden="true">
          {#if artwork}
            <img class="player-artwork-image" src={artwork.url} alt="" />
          {:else}
            <div class="player-artwork-placeholder"></div>
          {/if}
          {#if presentation !== 'now-playing'}
            <span class="player-artwork-fullscreen material-symbols-outlined">fullscreen</span>
          {/if}
        </div>
      </button>
    {/if}
    <slot name="artwork-controls" />

    <div class="player-track">
      {#if displayTrack}
        <button type="button" class="player-track-link player-track-title" on:click={handleShowTrack}>
          <strong>{getTrackDisplayTitle(displayTrack)}</strong>
          {#if displaySubsongCount > 1}
            <span class="player-subsong-position">{displaySubsong + 1}/{displaySubsongCount}</span>
          {/if}
        </button>
      {:else}
        <strong>{$t('main.player.welcome', { default: 'Welcome to izci!' })}</strong>
      {/if}
      {#if displayTrack}
        {#if getTrackDisplaySubtitle(displayTrack)}
          <button
            type="button"
            class="player-track-link player-track-subtitle"
            on:click={handleShowTrack}
          >
            {getTrackDisplaySubtitle(displayTrack)}
          </button>
        {/if}
      {:else}
        {#if collectionsReady}
          <span>
            {hasCollectionItems
              ? $appearanceSettings.showIdlePlayerQuips
                ? localizeIdlePlayerQuip(sessionIdlePlayerQuip)
                : $t('main.player.ready', { default: 'Ready' })
              : $t('main.player.dropFilesToBegin', { default: 'Drop files to begin' })}
          </span>
        {/if}
      {/if}
    </div>
  </div>

  {#if !imageMode}
  <div class="player-range">
    <span>{formatDuration(displayedSeekTime)}</span>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="range-control"
      style={toRangeProgressStyle(displayedSeekTime, Math.max(displayDuration, 1))}
      on:contextmenu={openBookmarkMenu}
    >
      {#each snapshot.buffered ?? [] as [bufferedStart, bufferedEnd] (bufferedStart)}
        <span
          class="range-control-buffered"
          aria-hidden="true"
          style={toBufferedRangeStyle(bufferedStart, bufferedEnd, Math.max(displayDuration, 1))}
        ></span>
      {/each}
      <span class="range-control-fill" aria-hidden="true"></span>
      <input
        type="range"
        min="0"
        max={Math.max(displayDuration, 1)}
        step="0.01"
        value={displayedSeekTime}
        disabled={!track || snapshot.duration <= 0 || isLoading}
        on:pointerdown={beginSeekPointer}
        on:input={previewSeek}
        on:pointerup={commitSeekPointer}
        on:pointercancel={cancelSeekPointer}
        on:wheel|preventDefault={handleSeekWheel}
      />
    </div>
    <span>{formatDuration(displayDuration)}</span>
  </div>
  {/if}

  <div class="player-control-strip">
    <div class="player-actions">
      <button
        type="button"
        class="transport-button transport-button-previous"
        aria-label={$t('main.player.previousTrack', { default: 'Previous track' })}
        on:click={() => dispatch('previous')}
        on:contextmenu={(event) => handleSubsongStep(event, -1)}
        disabled={(!track && !selectedTrack) || isLoading}
      >
      <span class="material-symbols-outlined" aria-hidden="true">skip_previous</span>
      </button>
      {#if !imageMode}
      <button
        type="button"
        class="transport-button transport-button-primary"
        aria-label={isLoading
          ? $t('main.player.loadingTrack', { default: 'Loading track…' })
          : snapshot.state === 'playing'
            ? $t('main.player.pausePlayback', { default: 'Pause playback' })
            : $t('main.player.playPlayback', { default: 'Play playback' })}
        on:click={() => dispatch('toggle')}
        disabled={(!track && !selectedTrack) || isLoading}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {isLoading ? 'progress_activity' : snapshot.state === 'playing' ? 'pause' : 'play_arrow'}
        </span>
      </button>
      {/if}
      <button
        type="button"
        class="transport-button transport-button-next"
        aria-label={$t('main.player.nextTrack', { default: 'Next track' })}
        on:click={() => dispatch('next')}
        on:contextmenu={(event) => handleSubsongStep(event, 1)}
        disabled={(!track && !selectedTrack) || isLoading}
      >
        <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>
      </button>
      {#if showVideoTheaterToggle}
        <button
          type="button"
          class="transport-button video-theater-toggle hover-tooltip-anchor"
          aria-label={videoTheaterToggleLabel}
          aria-pressed={videoTheaterActive}
          on:click={() => dispatch('toggleVideoTheater')}
        >
          <span class="material-symbols-outlined" aria-hidden="true">
            {videoTheaterActive ? 'close_fullscreen' : 'fit_screen'}
          </span>
          <HoverTooltip placement="above" align="center" nowrap>
            {videoTheaterToggleLabel}
          </HoverTooltip>
        </button>
      {/if}
      {#if presentation !== 'now-playing' && showFavoriteToggle}
        <div class="favorite-rating-control">
          <button
            bind:this={favoriteToggleElement}
            type="button"
            class="favorite-toggle hover-tooltip-anchor"
            class:active={favorite}
            aria-label={favorite
              ? $t('main.player.removeFromFavorites', { default: 'Remove from favorites' })
              : $t('main.player.addToFavorites', { default: 'Add to favorites' })}
            aria-pressed={favorite}
            disabled={!track}
            on:mouseenter={positionRatingPicker}
            on:focus={positionRatingPicker}
            on:click={() => dispatch('toggleFavorite')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              {favorite ? 'favorite' : 'favorite_border'}
            </span>
            {#if !ratingsEnabled}
              <HoverTooltip placement="above" align="center" nowrap>
                {favorite
                  ? $t('main.player.removeFromFavorites', { default: 'Remove from favorites' })
                  : $t('main.player.addToFavorites', { default: 'Add to favorites' })}
              </HoverTooltip>
            {/if}
          </button>
          {#if ratingsEnabled && track}
            <div
              class="player-rating-picker"
              use:portal
              style={`--rating-picker-x: ${ratingPickerX}px; --rating-picker-y: ${ratingPickerY}px;`}
            >
              <RatingPicker
                {rating}
                compact={presentation === 'theater'}
                on:change={(event) => dispatch('rate', event.detail)}
              />
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {#if !imageMode}
    <div
      class="volume"
      data-muted={snapshot.muted ? 'true' : 'false'}
      data-popup-open={isCompactVolume && isVolumePopupOpen ? 'true' : 'false'}
      on:mouseleave={closeVolumePopup}
    >
    {#if presentation !== 'now-playing' && showRafToggle}
      <button
        type="button"
        class:active={rafEnabled}
        class="raf-toggle hover-tooltip-anchor"
        aria-label={rafEnabled
          ? $t('main.player.bypassRaf', { default: 'Bypass Raf' })
          : $t('main.player.powerOnRaf', { default: 'Power on Raf' })}
        aria-pressed={rafEnabled}
        on:click={() => dispatch('toggleRaf')}
        on:contextmenu|preventDefault|stopPropagation={openRafPresetMenu}
      >
        <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
        <HoverTooltip placement="above" align="center" nowrap>
          {rafEnabled
            ? $t('main.player.bypassRafWithPresetHint', {
                default: 'Bypass Raf · Right-click for presets'
              })
            : $t('main.player.powerOnRafWithPresetHint', {
                default: 'Power on Raf · Right-click for presets'
              })}
        </HoverTooltip>
      </button>
    {/if}
    <div class="volume-control">
      <button
        type="button"
        class="volume-label"
        aria-label={snapshot.muted || snapshot.volume <= 0
          ? $t('main.player.unmute', { default: 'Unmute' })
          : $t('main.player.mute', { default: 'Mute' })}
        aria-expanded={isCompactVolume ? isVolumePopupOpen : undefined}
        aria-pressed={snapshot.muted}
        on:click={() => dispatch('mute')}
        on:mouseenter={openVolumePopup}
        on:focus={openVolumePopup}
        on:blur={closeVolumePopup}
        on:wheel|preventDefault={handleVolumeWheel}
      >
        <span class="material-symbols-outlined" aria-hidden="true">{getVolumeIcon(snapshot.volume, snapshot.muted)}</span>
        <span class="sr-only">{snapshot.muted || snapshot.volume <= 0
          ? $t('main.player.unmute', { default: 'Unmute' })
          : $t('main.player.mute', { default: 'Mute' })}</span>
      </button>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="volume-popup" on:mouseenter={openVolumePopup}>
        <div class="volume-popup-track">
          <div class="range-control volume-range" style={toRangeProgressStyle(snapshot.volume, 1)}>
            <span class="range-control-fill" aria-hidden="true"></span>
            <input
              aria-label={$t('main.player.volume', { default: 'Volume' })}
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={snapshot.volume}
              disabled={snapshot.muted}
              on:input={(event) => dispatch('volume', Number((event.currentTarget as HTMLInputElement).value))}
              on:wheel|preventDefault={handleVolumeWheel}
            />
          </div>
        </div>
      </div>
    </div>
    </div>
    {/if}
  </div>
</svelte:element>

{#if bookmarkMenuOpen}
  <MenuSurface
    items={bookmarkMenuItems}
    x={bookmarkMenuX}
    y={bookmarkMenuY}
    ariaLabel={$t('main.player.playerMenu', { default: 'Player' })}
    enableOverflowSubmenuFallback
    on:action={(event) => handleBookmarkAction(event.detail)}
    on:dismiss={() => (bookmarkMenuOpen = false)}
  />
{/if}

{#if rafPresetMenuOpen}
  <div
    bind:this={rafPresetMenuElement}
    class="menu-list raf-preset-context-menu"
    data-menu-interactive="true"
    use:portal
    use:windowDismiss={{ enabled: true, onDismiss: closeRafPresetMenu }}
    role="menu"
    aria-label={$t('main.player.rafPresets', { default: 'Raf presets' })}
    style={`left: ${rafPresetMenuX}px; top: ${rafPresetMenuY}px;`}
  >
    {#if rafPresets.length > 0}
      {#each rafPresets as preset (preset.id)}
        <button role="menuitemradio" aria-checked={preset.id === selectedRafPresetId} on:click={() => applyRafPreset(preset.id)}>
          <span class="material-symbols-outlined menu-item-icon preset-check" aria-hidden="true">check</span>
          <span class="menu-item-label">{preset.name}{preset.id === selectedRafPresetId && rafPresetDirty ? ' *' : ''}</span>
        </button>
      {/each}
    {:else}
      <button type="button" role="menuitem" disabled>
        <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">tune</span>
        <span class="menu-item-label">{$t('main.player.noRafPresets', { default: 'No Raf presets' })}</span>
      </button>
    {/if}
    <div class="menu-separator" role="separator" aria-hidden="true"></div>
    <button role="menuitem" on:click={() => { closeRafPresetMenu(); dispatch('openRafOptions'); }}>
      <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">tune</span>
      <span class="menu-item-label">{$t('main.player.openRaf', { default: 'Open Raf' })}</span>
    </button>
  </div>
{/if}

<style>
  .player-artwork-button,
  .player-track-link {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .player-track-title,
  .player-track-subtitle {
    text-align: left;
  }

  .raf-preset-context-menu {
    position: fixed;
    z-index: 60;
    width: 12rem;
    max-height: min(320px, calc(100vh - 12px));
    overflow: auto;
  }

  .raf-preset-context-menu .preset-check {
    visibility: hidden;
    flex: 0 0 auto;
    color: var(--accent-strong);
  }

  .raf-preset-context-menu button[aria-checked='true'] .preset-check {
    visibility: visible;
  }

</style>
