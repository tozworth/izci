<script lang="ts">
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import type {
    TrackLibraryNavigationField,
    TrackLibraryNavigationTarget,
    TrackLibraryNavigationTargets
  } from '$lib/services/library-navigation';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import type { MediaEntity } from '$lib/contracts/catalog';
  import { resolveModuleDisplayFormat, resolveModuleTrackerName } from '$lib/utils/files';

  export let track: MediaEntity | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundActive = false;
  export let artworkBackgroundBright = false;
  export let visualizerBackdropActive = false;
  export let hideEyebrow = false;
  export let isCompactWorkspace = false;
  export let fillParent = false;
  export let showCloseButton = false;
  export let onClose: () => void = () => {};
  export let libraryTargets: TrackLibraryNavigationTargets = {};
  export let onNavigateToLibrary: (target: TrackLibraryNavigationTarget) => void = () => {};

  interface MetadataEntry {
    label: string;
    icon: string;
    value: string;
    libraryField?: TrackLibraryNavigationField;
  }

  interface MetadataLabels {
    album: string;
    albumArtist: string;
    composer: string;
    discAndTrack: string;
    discNumber: string;
    genre: string;
    trackNumber: string;
    year: string;
  }

  function trimMetadataValue(value: string | undefined): string {
    return value?.trim() || '';
  }

  function metadataValuesMatch(left: string, right: string): boolean {
    return left.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()
      === right.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
  }

  function navigateToLibrary(field: TrackLibraryNavigationField | undefined): void {
    if (!field) return;
    const target = libraryTargets[field];
    if (target) onNavigateToLibrary(target);
  }

  function buildTrackNumberEntry(metadata: MediaEntity['metadata'], labels: MetadataLabels): MetadataEntry | null {
    const trackNumber = trimMetadataValue(metadata?.trackNumber);
    const discNumber = trimMetadataValue(metadata?.discNumber);

    if (!trackNumber) {
      return discNumber
        ? { label: labels.discNumber, icon: 'format_list_numbered', value: discNumber }
        : null;
    }

    return discNumber
      ? { label: labels.discAndTrack, icon: 'format_list_numbered', value: `${discNumber} / ${trackNumber}` }
      : { label: labels.trackNumber, icon: 'format_list_numbered', value: trackNumber };
  }

  function buildStreamMetadataEntries(track: MediaEntity | null, labels: MetadataLabels): MetadataEntry[] {
    if (!track || track.kind !== 'stream') {
      return [];
    }

    const metadata = track.metadata;
    const trackNumberEntry = buildTrackNumberEntry(metadata, labels);
    const title = trimMetadataValue(metadata?.title);
    const artist = trimMetadataValue(metadata?.artist);
    const album = trimMetadataValue(metadata?.album);
    const albumArtist = trimMetadataValue(metadata?.albumArtist);

    return [
      title && metadataValuesMatch(album, title)
        ? null
        : { label: labels.album, icon: 'album', value: album, libraryField: 'album' },
      artist && metadataValuesMatch(albumArtist, artist)
        ? null
        : { label: labels.albumArtist, icon: 'person', value: albumArtist },
      { label: labels.genre, icon: 'category', value: trimMetadataValue(metadata?.genre), libraryField: 'genre' },
      { label: labels.year, icon: 'calendar_month', value: trimMetadataValue(metadata?.year), libraryField: 'year' },
      trackNumberEntry,
      { label: labels.composer, icon: 'edit_note', value: trimMetadataValue(metadata?.composer) }
    ].filter((entry): entry is MetadataEntry => Boolean(entry && entry.value.length > 0));
  }

  function formatReplayGainValue(value: number): string {
    const formatted = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
      signDisplay: 'exceptZero'
    }).format(value);

    return `${formatted} dB`;
  }

  $: title = track?.metadata?.title?.trim() || '';
  $: showTrackSection = title.length > 0;
  $: artist = track?.metadata?.artist?.trim() || '';
  $: showArtist = showTrackSection && artist.length > 0 && artist.toLowerCase() !== 'unknown';
  $: metadataLabels = {
    album: $t('main.trackDetails.album', { default: 'Album' }),
    albumArtist: $t('main.trackDetails.albumArtist', { default: 'Album Artist' }),
    composer: $t('main.trackDetails.composer', { default: 'Composer' }),
    discAndTrack: $t('main.trackDetails.discAndTrack', { default: 'Disc / Track' }),
    discNumber: $t('main.trackDetails.discNumber', { default: 'Disc Number' }),
    genre: $t('main.trackDetails.genre', { default: 'Genre' }),
    trackNumber: $t('main.trackDetails.trackNumber', { default: 'Track Number' }),
    year: $t('main.trackDetails.year', { default: 'Year' })
  } satisfies MetadataLabels;
  $: metadataEntries = buildStreamMetadataEntries(track, metadataLabels);
  $: libraryTooltipLabels = {
    artist: $t('main.trackDetails.goToArtist', { default: 'Go to artist' }),
    album: $t('main.trackDetails.goToAlbum', { default: 'Go to album' }),
    genre: $t('main.trackDetails.goToGenre', { default: 'Go to genre' }),
    year: $t('main.trackDetails.goToYear', { default: 'Go to year' }),
    format: $t('main.trackDetails.goToFormat', { default: 'Go to format' })
  } satisfies Record<TrackLibraryNavigationField, string>;
  $: tracker = track?.kind === 'module'
    ? resolveModuleTrackerName(track.format, track.metadata?.trackerType)
    : '';
  $: tracks = track?.metadata?.tracks;
  $: patterns = track?.metadata?.patterns;
  $: notes = track?.metadata?.message?.trim() || '';
  $: bitrate = track?.kind === 'stream' ? track.metadata?.bitrate : undefined;
  $: formatValue = track
    ? track.kind === 'module'
      ? resolveModuleDisplayFormat(track.format, track.metadata)
      : track.format.toUpperCase()
    : '';
  $: formatDetail = track
    ? track.kind === 'stream'
      ? bitrate
        ? `${bitrate} kbps`
        : ''
      : track.kind === 'module'
        ? tracker
        : ''
    : '';
  $: replayGain = track?.kind === 'stream' ? track.metadata?.replayGain : undefined;
  $: replayGainParts = [
    typeof replayGain?.trackGainDb === 'number'
      ? $t('main.trackDetails.replayGainTrack', {
          default: 'Track {gain}',
          values: { gain: formatReplayGainValue(replayGain.trackGainDb) }
        })
      : '',
    typeof replayGain?.albumGainDb === 'number'
      ? $t('main.trackDetails.replayGainAlbum', {
          default: 'Album {gain}',
          values: { gain: formatReplayGainValue(replayGain.albumGainDb) }
        })
      : ''
  ].filter(Boolean);
  $: replayGainSummary = replayGainParts.join(' · ');
  $: patternSummary =
    track?.kind === 'module' && typeof patterns === 'number'
      ? $t('main.trackDetails.patternCount', {
          default: '{count, plural, one {# pattern} other {# patterns}}',
          values: { count: patterns }
        })
      : '';
  $: trackSummary =
    track?.kind === 'module' && typeof tracks === 'number'
      ? $t('main.trackDetails.trackCount', {
          default: '{count, plural, one {# track} other {# tracks}}',
          values: { count: tracks }
        })
      : '';
  $: subsongCount = track?.kind === 'module' ? Math.max(track.metadata?.subsongs ?? 1, 1) : 1;
  $: subsongName = track?.subsong !== undefined
    ? track.metadata?.subsongNames?.[track.subsong]?.trim() ?? ''
    : '';
  $: subsongSummary = subsongCount > 1
    ? track?.subsong !== undefined
      ? subsongName
        ? $t('main.trackDetails.subsongPositionNamed', {
            default: 'Subsongs: {position} of {count} · {name}',
            values: { position: track.subsong + 1, count: subsongCount, name: subsongName }
          })
        : $t('main.trackDetails.subsongPosition', {
            default: 'Subsongs: {position} of {count}',
            values: { position: track.subsong + 1, count: subsongCount }
          })
      : $t('main.trackDetails.subsongAvailable', {
          default: 'Subsongs: {count, plural, one {# available} other {# available}}',
          values: { count: subsongCount }
        })
    : '';
</script>

<section
  class="panel details-panel"
  class:fill-parent={fillParent}
  class:artwork-background-active={artworkBackgroundActive}
  class:artwork-background-bright={artworkBackgroundActive && artworkBackgroundBright}
  class:visualizer-backdrop-active={visualizerBackdropActive}
>
  <div class="panel-header">
    <div class="panel-heading">
      {#if !hideEyebrow}
        <p class="eyebrow">{$t('main.trackDetails.heading', { default: 'Track Details' })}</p>
      {/if}
    </div>

    {#if showCloseButton}
      <button
        type="button"
        class="details-close-button hover-tooltip-anchor"
        aria-label={$t('main.trackDetails.closePanel', { default: 'Close Track Details' })}
        on:click={onClose}
      >
        <span class="details-close-label" aria-hidden="true">{$t('main.common.close', { default: 'Close' })}</span>
        <span class="material-symbols-outlined details-close-icon" aria-hidden="true">close</span>
        <HoverTooltip nowrap>{$t('main.common.close', { default: 'Close' })}</HoverTooltip>
      </button>
    {/if}
  </div>

  {#if track}
    <div class="details-content" class:compact-workspace={isCompactWorkspace}>
      {#if showTrackSection}
        <section class="detail-section track-copy">
          {#if artwork && track.kind !== 'video'}
            <div class="track-artwork" aria-hidden="true">
              <img class="track-artwork-image" src={artwork.url} alt="" />
            </div>
          {/if}
          <h2 class="track-title">{title}</h2>
          {#if showArtist}
            {#if libraryTargets.artist}
              <button
                type="button"
                class="track-artist details-library-link hover-tooltip-anchor"
                aria-label={libraryTooltipLabels.artist}
                on:click={() => navigateToLibrary('artist')}
              >
                <span>{artist}</span>
                <HoverTooltip align="left" nowrap>{libraryTooltipLabels.artist}</HoverTooltip>
              </button>
            {:else}
              <p class="track-artist">{artist}</p>
            {/if}
          {/if}
        </section>
      {/if}

      {#if metadataEntries.length > 0}
        <section class="detail-section metadata-section">
          <dl class="metadata-list">
            {#each metadataEntries as entry}
              <div class="metadata-row">
                <dt class="hover-tooltip-anchor">
                  <span
                    class="material-symbols-outlined metadata-icon"
                    aria-label={entry.label}
                  >{entry.icon}</span>
                  <HoverTooltip align="left" nowrap>{entry.label}</HoverTooltip>
                </dt>
                <dd>
                  {#if entry.libraryField && libraryTargets[entry.libraryField]}
                    <button
                      type="button"
                      class="details-library-link hover-tooltip-anchor"
                      aria-label={libraryTooltipLabels[entry.libraryField]}
                      on:click={() => navigateToLibrary(entry.libraryField)}
                    >
                      <span>{entry.value}</span>
                      <HoverTooltip align="left" nowrap>{libraryTooltipLabels[entry.libraryField]}</HoverTooltip>
                    </button>
                  {:else}
                    {entry.value}
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
        </section>
      {/if}

      <section class="detail-section technical-section">
        <dl class="metadata-list">
          <div class="metadata-row">
            <dt class="hover-tooltip-anchor">
              <span
                class="material-symbols-outlined metadata-icon"
                aria-label={$t('main.trackDetails.format', { default: 'Format' })}
              >equalizer</span>
              <HoverTooltip align="left" nowrap>{$t('main.trackDetails.format', { default: 'Format' })}</HoverTooltip>
            </dt>
            <dd>
              {#if libraryTargets.format}
                <button
                  type="button"
                  class="details-library-link hover-tooltip-anchor"
                  aria-label={libraryTooltipLabels.format}
                  on:click={() => navigateToLibrary('format')}
                >
                  <span>{formatValue}</span>
                  {#if formatDetail}
                    <span class="technical-detail">{formatDetail}</span>
                  {/if}
                  <HoverTooltip align="left" nowrap>{libraryTooltipLabels.format}</HoverTooltip>
                </button>
              {:else}
                <span>{formatValue}</span>
                {#if formatDetail}
                  <span class="technical-detail">{formatDetail}</span>
                {/if}
              {/if}
            </dd>
          </div>

          {#if replayGainSummary}
            <div class="metadata-row">
              <dt class="hover-tooltip-anchor">
                <span
                  class="material-symbols-outlined metadata-icon"
                  aria-label={$t('main.trackDetails.replayGain', { default: 'ReplayGain' })}
                >volume_up</span>
                <HoverTooltip align="left" nowrap>{$t('main.trackDetails.replayGain', { default: 'ReplayGain' })}</HoverTooltip>
              </dt>
              <dd>{replayGainSummary}</dd>
            </div>
          {/if}

          {#if patternSummary}
            <div class="metadata-row">
              <dt class="hover-tooltip-anchor">
                <span
                  class="material-symbols-outlined metadata-icon"
                  aria-label={$t('main.trackDetails.patterns', { default: 'Patterns' })}
                >grid_view</span>
                <HoverTooltip align="left" nowrap>{$t('main.trackDetails.patterns', { default: 'Patterns' })}</HoverTooltip>
              </dt>
              <dd>{patternSummary}</dd>
            </div>
          {/if}

          {#if trackSummary}
            <div class="metadata-row">
              <dt class="hover-tooltip-anchor">
                <span
                  class="material-symbols-outlined metadata-icon"
                  aria-label={$t('main.trackDetails.tracks', { default: 'Tracks' })}
                >timeline</span>
                <HoverTooltip align="left" nowrap>{$t('main.trackDetails.tracks', { default: 'Tracks' })}</HoverTooltip>
              </dt>
              <dd>{trackSummary}</dd>
            </div>
          {/if}

          {#if subsongSummary}
            <div class="metadata-row">
              <dt class="hover-tooltip-anchor">
                <span
                  class="material-symbols-outlined metadata-icon"
                  aria-label={$t('main.trackDetails.subsongs', { default: 'Subsongs' })}
                >queue_music</span>
                <HoverTooltip align="left" nowrap>{$t('main.trackDetails.subsongs', { default: 'Subsongs' })}</HoverTooltip>
              </dt>
              <dd class="technical-detail">{subsongSummary}</dd>
            </div>
          {/if}
        </dl>
      </section>

      {#if notes}
        <section class="detail-section notes-block">
          <p class="section-heading">
            <span class="material-symbols-outlined section-icon" aria-hidden="true">notes</span>
            <span>{$t('main.trackDetails.notes', { default: 'Notes' })}</span>
          </p>
          <pre>{notes}</pre>
        </section>
      {/if}
    </div>
  {:else}
    <div class="empty-state details-empty-state" class:compact-workspace={isCompactWorkspace}>
      <span class="material-symbols-outlined details-empty-icon" aria-hidden="true">info</span>
      <p>{$t('main.trackDetails.emptyTitle', { default: 'Select a track to view details.' })}</p>
    </div>
  {/if}
</section>

<style>
  .details-panel {
    position: relative;
    isolation: isolate;
  }

  .details-panel.fill-parent {
    width: 100%;
    min-width: 0;
    height: 100%;
  }

  .details-panel > * {
    position: relative;
    z-index: 1;
  }

  .panel-header {
    align-items: center;
  }

  .details-close-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-end;
    gap: 0.22rem;
    min-width: 5.75rem;
    padding: 0;
    line-height: 1;
    color: var(--muted);
    background: transparent;
    transition: none;
  }

  .details-close-button:hover,
  .details-close-button:focus-visible {
    color: var(--text);
  }

  .details-close-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .details-close-label {
    overflow: hidden;
    max-width: 0;
    opacity: 0;
    white-space: nowrap;
    transition: none;
  }

  .details-close-button:hover .details-close-label,
  .details-close-button:focus-visible .details-close-label {
    max-width: 3.5rem;
    opacity: 1;
  }

  .details-close-icon {
    font-size: 1.1rem;
  }

  .details-content {
    display: grid;
    align-content: start;
    grid-auto-rows: max-content;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 0.72rem;
  }

  .details-content.compact-workspace,
  .empty-state.compact-workspace {
    padding-bottom: calc(7rem + env(safe-area-inset-bottom, 0px));
  }

  .details-empty-state {
    align-content: center;
    justify-items: center;
    flex: 1;
    gap: 0.35rem;
  }

  .details-empty-state p {
    margin: 0;
  }

  .details-empty-icon {
    font-size: 1.15rem;
  }

  .detail-section {
    display: grid;
    gap: 0.2rem;
    padding: 0.46rem 0;
  }

  .detail-section:first-child {
    padding-top: 0;
  }

  .detail-section + .detail-section {
    border-top: 1px solid var(--border-soft);
  }

  .track-copy {
    gap: 0.2rem;
  }

  .track-artwork {
    justify-self: center;
    width: min(100%, 16rem);
    aspect-ratio: 1;
    border-radius: var(--track-artwork-radius);
    overflow: hidden;
    background:
      linear-gradient(180deg, var(--hover-control), transparent 100%),
      var(--bg-soft);
    box-shadow:
      inset 0 0 0 1px var(--border-strong),
      0 0 0 1px rgba(0, 0, 0, 0.08);
    transition:
      background var(--artwork-ui-transition-duration, 280ms) linear,
      box-shadow var(--artwork-ui-transition-duration, 280ms) linear;
  }

  .track-artwork-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .section-heading {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: 0.82rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--text);
  }

  .section-icon {
    font-size: 1rem;
    color: var(--muted);
  }

  .track-title {
    margin: 0;
    font-size: 1.18rem;
    line-height: 1.1;
    font-weight: 700;
    color: var(--text-strong);
  }

  .track-artist {
    margin: 0;
    color: var(--muted);
    font-size: 0.84rem;
  }

  .metadata-list {
    display: grid;
    gap: 0.32rem;
    margin: 0;
  }

  .metadata-row {
    display: grid;
    grid-template-columns: 1rem minmax(0, 1fr);
    gap: 0.42rem;
    align-items: start;
  }

  .metadata-row dt,
  .metadata-row dd {
    margin: 0;
    min-width: 0;
  }

  .metadata-row dt {
    color: var(--muted);
    line-height: 1.25;
  }

  .metadata-icon {
    display: block;
    font-size: 1rem;
    transform: translateY(0.1rem);
  }

  button.track-artist {
    justify-self: start;
  }

  .details-library-link {
    display: inline-flex;
    align-items: baseline;
    gap: 0.42rem;
    min-width: 0;
    max-width: 100%;
    margin: -0.08rem -0.2rem;
    padding: 0.08rem 0.2rem;
    border-radius: 0.22rem;
    color: inherit;
    background: transparent;
    text-align: left;
    overflow-wrap: anywhere;
    transition: color 90ms ease-out, background 90ms ease-out, box-shadow 90ms ease-out;
  }

  .details-library-link:hover,
  .details-library-link:focus-visible {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    box-shadow: 0 0 0.5rem color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .details-library-link:focus-visible {
    outline: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: 1px;
  }

  .metadata-row dd {
    color: var(--text);
    text-align: left;
    overflow-wrap: anywhere;
  }

  .technical-detail {
    color: var(--muted);
  }

  .metadata-row dd .technical-detail {
    margin-left: 0.42rem;
  }

  .notes-block {
    min-height: 0;
  }

  .notes-block pre {
    margin: 0;
    font: 0.82rem/1.5 'IBM Plex Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
  }
</style>
