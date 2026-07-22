<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import type { PlaylistItem } from '$lib/types';
  import { resolveModuleDisplayFormat, resolveModuleTrackerName } from '$lib/utils/files';

  export let track: PlaylistItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundActive = false;
  export let artworkBackgroundBright = false;
  export let visualizerBackdropActive = false;
  export let hideEyebrow = false;
  export let isCompactWorkspace = false;
  export let fillParent = false;
  export let showCloseButton = false;
  export let onClose: () => void = () => {};

  interface MetadataEntry {
    label: string;
    icon: string;
    value: string;
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

  function buildTrackNumberEntry(metadata: PlaylistItem['metadata'], labels: MetadataLabels): MetadataEntry | null {
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

  function buildStreamMetadataEntries(track: PlaylistItem | null, labels: MetadataLabels): MetadataEntry[] {
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
        : { label: labels.album, icon: 'album', value: album },
      artist && metadataValuesMatch(albumArtist, artist)
        ? null
        : { label: labels.albumArtist, icon: 'person', value: albumArtist },
      { label: labels.genre, icon: 'category', value: trimMetadataValue(metadata?.genre) },
      { label: labels.year, icon: 'calendar_month', value: trimMetadataValue(metadata?.year) },
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
  $: tracker = track ? resolveModuleTrackerName(track.extension, track.metadata?.trackerType) : '';
  $: patterns = track?.metadata?.patterns;
  $: notes = track?.metadata?.message?.trim() || '';
  $: bitrate = track?.kind === 'stream' ? track.metadata?.bitrate : undefined;
  $: formatValue = track
    ? track.kind === 'stream'
      ? track.extension.toUpperCase()
      : resolveModuleDisplayFormat(track.extension, track.metadata)
    : '';
  $: formatDetail = track
    ? track.kind === 'stream'
      ? bitrate
        ? `${bitrate} kbps`
        : ''
      : tracker
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
        class="details-close-button"
        aria-label={$t('main.trackDetails.closePanel', { default: 'Close Track Details' })}
        title={$t('main.common.close', { default: 'Close' })}
        on:click={onClose}
      >
        <span class="details-close-label" aria-hidden="true">{$t('main.common.close', { default: 'Close' })}</span>
        <span class="material-symbols-outlined details-close-icon" aria-hidden="true">close</span>
      </button>
    {/if}
  </div>

  {#if track}
    <div class="details-content" class:compact-workspace={isCompactWorkspace}>
      {#if showTrackSection}
        <section class="detail-section track-copy">
          {#if artwork}
            <div class="track-artwork" aria-hidden="true">
              <img class="track-artwork-image" src={artwork.url} alt="" />
            </div>
          {/if}
          <h2 class="track-title">{title}</h2>
          {#if showArtist}
            <p class="track-artist">{artist}</p>
          {/if}
        </section>
      {/if}

      {#if metadataEntries.length > 0}
        <section class="detail-section metadata-section">
          <dl class="metadata-list">
            {#each metadataEntries as entry}
              <div class="metadata-row">
                <dt>
                  <span
                    class="material-symbols-outlined metadata-icon"
                    title={entry.label}
                    aria-label={entry.label}
                  >{entry.icon}</span>
                </dt>
                <dd>{entry.value}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/if}

      <section class="detail-section technical-section">
        <dl class="metadata-list">
          <div class="metadata-row">
            <dt>
              <span
                class="material-symbols-outlined metadata-icon"
                title={$t('main.trackDetails.format', { default: 'Format' })}
                aria-label={$t('main.trackDetails.format', { default: 'Format' })}
              >equalizer</span>
            </dt>
            <dd>
              <span>{formatValue}</span>
              {#if formatDetail}
                <span class="technical-detail">{formatDetail}</span>
              {/if}
            </dd>
          </div>

          {#if replayGainSummary}
            <div class="metadata-row">
              <dt>
                <span
                  class="material-symbols-outlined metadata-icon"
                  title={$t('main.trackDetails.replayGain', { default: 'ReplayGain' })}
                  aria-label={$t('main.trackDetails.replayGain', { default: 'ReplayGain' })}
                >volume_up</span>
              </dt>
              <dd>{replayGainSummary}</dd>
            </div>
          {/if}

          {#if patternSummary}
            <div class="metadata-row">
              <dt>
                <span
                  class="material-symbols-outlined metadata-icon"
                  title={$t('main.trackDetails.patterns', { default: 'Patterns' })}
                  aria-label={$t('main.trackDetails.patterns', { default: 'Patterns' })}
                >grid_view</span>
              </dt>
              <dd>{patternSummary}</dd>
            </div>
          {/if}

          {#if subsongSummary}
            <div class="metadata-row">
              <dt>
                <span
                  class="material-symbols-outlined metadata-icon"
                  title={$t('main.trackDetails.subsongs', { default: 'Subsongs' })}
                  aria-label={$t('main.trackDetails.subsongs', { default: 'Subsongs' })}
                >queue_music</span>
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
    <div class="empty-state align-start" class:compact-workspace={isCompactWorkspace}>
      <p>{$t('main.trackDetails.emptyTitle', { default: 'Select a track to inspect it.' })}</p>
      <p>{$t('main.trackDetails.emptyDescription', {
        default: 'Playlist and library selections both surface their metadata here.'
      })}</p>
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
    font: 0.9rem/1.5 'IBM Plex Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
  }
</style>
