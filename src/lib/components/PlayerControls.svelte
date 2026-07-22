<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    extractArtworkPalette,
    type PlayerArtworkColorSet,
    type PlayerArtworkPalette
  } from '$lib/services/artwork-palette';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import { sessionIdlePlayerQuip, type IdlePlayerQuipId } from '$lib/services/idle-player-copy';
  import { portal } from '$lib/components/playlist-panel/actions/portal';
  import { windowDismiss } from '$lib/components/playlist-panel/actions/window-dismiss';
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
    PlaybackSnapshot,
    PlaylistItem,
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
  export let track: PlaylistItem | null = null;
  export let selectedTrack: PlaylistItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundBright = false;
  export let backdropEffect: BackdropZoneEffect = 'visualizer';
  export let backdropArtworkSettings: BackdropZoneArtworkSettings | null = null;
  export let presentation: 'bar' | 'now-playing' = 'bar';
  export let useArtworkColorsOverride: boolean | null = null;
  export let artworkColorSurfaceBright = false;
  export let hasCollectionItems = false;
  export let collectionsReady = true;
  export let showFavoriteToggle = false;
  export let favorite = false;
  export let showRafToggle = false;
  export let rafEnabled = true;
  export let rafPresets: RafPreset[] = [];
  export let selectedRafPresetId: string | null = null;
  export let rafPresetDirty = false;

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
    toggleRaf: void;
    applyRafPreset: string;
    openRafOptions: void;
    showTrack: string;
  }>();

  const COMPACT_VOLUME_QUERY = '(max-width: 349px)';
  const COMPACT_VOLUME_OPEN_DELAY_MS = 120;
  const RANGE_THUMB_SIZE_REM = 1.05;
  const PLAYER_BAR_RESERVE_PROPERTY = '--player-bar-measured-reserve';
  const SEEK_WHEEL_STEP_SECONDS = 5;

  let playerBarElement: HTMLElement | null = null;
  let playerBarResizeObserver: ResizeObserver | null = null;
  let playerBarReserveFrame: number | null = null;
  let viewportUsesCompactVolume = false;
  let isCompactVolume = false;
  let isVolumePopupOpen = false;
  let volumePopupTimer: ReturnType<typeof window.setTimeout> | null = null;
  let playerArtworkPalette: PlayerArtworkPalette | null = null;
  let playerArtworkPaletteUrl: string | undefined = undefined;
  let playerArtworkPaletteToken = 0;
  let rafPresetMenuOpen = false;
  let rafPresetMenuX = 0;
  let rafPresetMenuY = 0;
  let rafPresetMenuElement: HTMLDivElement | null = null;
  let seekPreview = 0;
  let seekPointerActive = false;
  let snapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0,
    muted: false,
    backend: null,
    error: undefined
  };
  $: containerElement = presentation === 'bar' ? 'footer' : 'section';

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function handleSeekWheel(event: WheelEvent) {
    if (!track || snapshot.duration <= 0) {
      return;
    }

    const delta = event.deltaY < 0 ? 1 : -1;
    dispatch(
      'seek',
      clamp(
        snapshot.currentTime + delta * SEEK_WHEEL_STEP_SECONDS,
        0,
        snapshot.duration
      )
    );
  }

  function beginSeekPointer(): void {
    seekPointerActive = true;
    seekPreview = snapshot.currentTime;
  }

  function previewSeek(event: Event): void {
    const seconds = Number((event.currentTarget as HTMLInputElement).value);
    seekPreview = seconds;

    // Keyboard changes are discrete, so apply them immediately. Pointer drags
    // commit once on release to avoid backend progress updates fighting the thumb.
    if (!seekPointerActive) {
      dispatch('seek', seconds);
    }
  }

  function commitSeekPointer(event: PointerEvent): void {
    if (!seekPointerActive) {
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

  function applyRafPreset(id: string) {
    dispatch('applyRafPreset', id);
    closeRafPresetMenu();
  }

  async function syncPlayerArtworkPalette(url: string | undefined): Promise<void> {
    const token = ++playerArtworkPaletteToken;
    playerArtworkPaletteUrl = url;
    playerArtworkPalette = null;

    if (!url) {
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

  function syncPlayerBarReserve() {
    playerBarReserveFrame = null;

    if (presentation !== 'bar') {
      clearPlayerBarReserve();
      return;
    }

    if (!playerBarElement) {
      clearPlayerBarReserve();
      return;
    }

    const height = Math.ceil(playerBarElement.getBoundingClientRect().height);

    if (height <= 0) {
      clearPlayerBarReserve();
      return;
    }

    getAppShell()?.style.setProperty(PLAYER_BAR_RESERVE_PROPERTY, `${height}px`);
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

    if (presentation === 'bar' && typeof ResizeObserver !== 'undefined' && playerBarElement) {
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
    };
  });

  $: snapshot = $snapshotStore;
  $: if (!seekPointerActive) seekPreview = snapshot.currentTime;
  $: displayedSeekTime = seekPointerActive ? seekPreview : snapshot.currentTime;
  $: compactPlayerBar = presentation === 'bar' && $appearanceSettings.compactPlayerBar;
  $: isCompactVolume = viewportUsesCompactVolume || compactPlayerBar;
  $: displayTrack = track;
  $: displayDuration = track ? snapshot.duration : 0;
  $: displaySubsongCount = displayTrack?.kind === 'module'
    ? Math.max(snapshot.subsongCount ?? displayTrack.metadata?.subsongs ?? 1, 1)
    : 1;
  $: displaySubsong = displayTrack?.kind === 'module'
    ? Math.min(Math.max(snapshot.subsong ?? displayTrack.subsong ?? 0, 0), displaySubsongCount - 1)
    : 0;
  $: artworkBackgroundActive = hasArtworkBackdrop(backdropEffect) && Boolean(artwork);
  $: visualizerBackdropActive = hasVisualizerBackdrop(backdropEffect);
  $: playerArtworkPaletteActive =
    (useArtworkColorsOverride ?? $appearanceSettings.useArtworkPlayerColors) &&
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
  class:compact-player-bar={compactPlayerBar}
  class:artwork-background-active={artworkBackgroundActive}
  class:artwork-background-bright={artworkBackgroundActive && artworkBackgroundBright}
  class:visualizer-backdrop-active={visualizerBackdropActive}
  aria-label={presentation === 'now-playing'
    ? $t('main.player.nowPlayingControls', { default: 'Now Playing controls' })
    : undefined}
  data-artwork-zone={artworkBackgroundActive ? 'true' : null}
  data-visualizer-zone={visualizerBackdropActive ? 'true' : null}
  data-backdrop-zone-id={presentation === 'bar' ? 'player' : null}
  style={rootStyle}
>
  <div class="player-track-group">
    {#if displayTrack?.kind !== 'video'}
      <button
        type="button"
        class="player-artwork-button"
        aria-label={$t('main.player.showCurrentTrackDetails', { default: 'Show current track details' })}
        disabled={!displayTrack}
        on:click={handleShowTrack}
      >
        <div class="player-artwork" aria-hidden="true">
          {#if artwork}
            <img class="player-artwork-image" src={artwork.url} alt="" />
          {:else}
            <div class="player-artwork-placeholder"></div>
          {/if}
        </div>
      </button>
    {/if}

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

  <div class="player-range">
    <span>{formatDuration(displayedSeekTime)}</span>
    <div class="range-control" style={toRangeProgressStyle(displayedSeekTime, Math.max(displayDuration, 1))}>
      <span class="range-control-fill" aria-hidden="true"></span>
      <input
        type="range"
        min="0"
        max={Math.max(displayDuration, 1)}
        step="0.01"
        value={displayedSeekTime}
        disabled={!track || snapshot.duration <= 0}
        on:pointerdown={beginSeekPointer}
        on:input={previewSeek}
        on:pointerup={commitSeekPointer}
        on:pointercancel={cancelSeekPointer}
        on:wheel|preventDefault={handleSeekWheel}
      />
    </div>
    <span>{formatDuration(displayDuration)}</span>
  </div>

  <div class="player-control-strip">
    <div class="player-actions">
      <button
        type="button"
        class="transport-button transport-button-previous"
        aria-label={$t('main.player.previousTrack', { default: 'Previous track' })}
        title={displaySubsongCount > 1
          ? $t('main.player.previousTrackWithSubsongHint', {
              default: 'Previous track · Right-click for previous subsong'
            })
          : $t('main.player.previousTrack', { default: 'Previous track' })}
        on:click={() => dispatch('previous')}
        on:contextmenu={(event) => handleSubsongStep(event, -1)}
        disabled={!track && !selectedTrack}
      >
      <span class="material-symbols-outlined" aria-hidden="true">skip_previous</span>
      </button>
      <button
        type="button"
        class="transport-button transport-button-primary"
        aria-label={snapshot.state === 'playing'
          ? $t('main.player.pausePlayback', { default: 'Pause playback' })
          : $t('main.player.playPlayback', { default: 'Play playback' })}
        on:click={() => dispatch('toggle')}
        disabled={!track && !selectedTrack}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {snapshot.state === 'playing' ? 'pause' : 'play_arrow'}
        </span>
      </button>
      <button
        type="button"
        class="transport-button transport-button-next"
        aria-label={$t('main.player.nextTrack', { default: 'Next track' })}
        title={displaySubsongCount > 1
          ? $t('main.player.nextTrackWithSubsongHint', {
              default: 'Next track · Right-click for next subsong'
            })
          : $t('main.player.nextTrack', { default: 'Next track' })}
        on:click={() => dispatch('next')}
        on:contextmenu={(event) => handleSubsongStep(event, 1)}
        disabled={!track && !selectedTrack}
      >
        <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>
      </button>
      {#if presentation === 'bar' && showFavoriteToggle}
        <button
          type="button"
          class="favorite-toggle"
          class:active={favorite}
          aria-label={favorite
            ? $t('main.player.removeFromFavorites', { default: 'Remove from favorites' })
            : $t('main.player.addToFavorites', { default: 'Add to favorites' })}
          aria-pressed={favorite}
          title={favorite
            ? $t('main.player.removeFromFavorites', { default: 'Remove from favorites' })
            : $t('main.player.addToFavorites', { default: 'Add to favorites' })}
          disabled={!track}
          on:click={() => dispatch('toggleFavorite')}
        >
          <span class="material-symbols-outlined" aria-hidden="true">
            {favorite ? 'favorite' : 'favorite_border'}
          </span>
        </button>
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="volume"
      data-muted={snapshot.muted ? 'true' : 'false'}
      data-popup-open={isCompactVolume && isVolumePopupOpen ? 'true' : 'false'}
      on:mouseleave={closeVolumePopup}
    >
    {#if presentation === 'bar' && showRafToggle}
      <button
        type="button"
        class:active={rafEnabled}
        class="raf-toggle"
        aria-label={rafEnabled
          ? $t('main.player.bypassRaf', { default: 'Bypass Raf' })
          : $t('main.player.powerOnRaf', { default: 'Power on Raf' })}
        aria-pressed={rafEnabled}
        title={rafEnabled
          ? $t('main.player.bypassRafWithPresetHint', {
              default: 'Bypass Raf · Right-click for presets'
            })
          : $t('main.player.powerOnRafWithPresetHint', {
              default: 'Power on Raf · Right-click for presets'
            })}
        on:click={() => dispatch('toggleRaf')}
        on:contextmenu|preventDefault|stopPropagation={openRafPresetMenu}
      >
        <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
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
  </div>
</svelte:element>

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
