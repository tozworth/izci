<script lang="ts">
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import type { PlaylistItem } from '$lib/types';
  import { resolveModuleDisplayFormat, resolveModuleTrackerName } from '$lib/utils/files';

  export let track: PlaylistItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundActive = false;
  export let artworkBackgroundBright = false;
  export let visualizerBackdropActive = false;
  export let hideEyebrow = false;
  export let isTabbedLayout = false;
  export let fillParent = false;
  export let showCloseButton = false;
  export let onClose: () => void = () => {};

  interface MetadataEntry {
    label: string;
    icon: string;
    value: string;
  }

  function trimMetadataValue(value: string | undefined): string {
    return value?.trim() || '';
  }

  function metadataValuesMatch(left: string, right: string): boolean {
    return left.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()
      === right.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
  }

  function buildTrackNumberEntry(metadata: PlaylistItem['metadata']): MetadataEntry | null {
    const trackNumber = trimMetadataValue(metadata?.trackNumber);
    const discNumber = trimMetadataValue(metadata?.discNumber);

    if (!trackNumber) {
      return discNumber
        ? { label: 'Disc Number', icon: 'format_list_numbered', value: discNumber }
        : null;
    }

    return discNumber
      ? { label: 'Disc / Track', icon: 'format_list_numbered', value: `${discNumber} / ${trackNumber}` }
      : { label: 'Track Number', icon: 'format_list_numbered', value: trackNumber };
  }

  function buildStreamMetadataEntries(track: PlaylistItem | null): MetadataEntry[] {
    if (!track || track.kind !== 'stream') {
      return [];
    }

    const metadata = track.metadata;
    const trackNumberEntry = buildTrackNumberEntry(metadata);
    const title = trimMetadataValue(metadata?.title);
    const artist = trimMetadataValue(metadata?.artist);
    const album = trimMetadataValue(metadata?.album);
    const albumArtist = trimMetadataValue(metadata?.albumArtist);

    return [
      title && metadataValuesMatch(album, title)
        ? null
        : { label: 'Album', icon: 'album', value: album },
      artist && metadataValuesMatch(albumArtist, artist)
        ? null
        : { label: 'Album Artist', icon: 'person', value: albumArtist },
      { label: 'Genre', icon: 'category', value: trimMetadataValue(metadata?.genre) },
      { label: 'Year', icon: 'calendar_month', value: trimMetadataValue(metadata?.year) },
      trackNumberEntry,
      { label: 'Composer', icon: 'edit_note', value: trimMetadataValue(metadata?.composer) }
    ].filter((entry): entry is MetadataEntry => Boolean(entry && entry.value.length > 0));
  }

  $: title = track?.metadata?.title?.trim() || '';
  $: showTrackSection = title.length > 0;
  $: artist = track?.metadata?.artist?.trim() || '';
  $: showArtist = showTrackSection && artist.length > 0 && artist.toLowerCase() !== 'unknown';
  $: metadataEntries = buildStreamMetadataEntries(track);
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
  $: patternSummary =
    track?.kind === 'module' && typeof patterns === 'number'
      ? `${patterns} pattern${patterns === 1 ? '' : 's'}`
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
        <p class="eyebrow">Track Details</p>
      {/if}
    </div>

    {#if showCloseButton}
      <button
        type="button"
        class="details-close-button"
        aria-label="Close Track Details"
        title="Close"
        on:click={onClose}
      >
        <span class="details-close-label" aria-hidden="true">Close</span>
        <span class="material-symbols-outlined details-close-icon" aria-hidden="true">close</span>
      </button>
    {/if}
  </div>

  {#if track}
    <div class="details-content" class:tabbed-layout={isTabbedLayout}>
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

      <section class="detail-section format-section">
        <p class="section-heading">
          <span class="material-symbols-outlined section-icon" aria-hidden="true">equalizer</span>
          <span>Format</span>
        </p>
        <div class="format-copy">
          <p class="format-value">{formatValue}</p>
          {#if formatDetail}
            <p class="format-detail">{formatDetail}</p>
          {/if}
          {#if patternSummary}
            <p class="pattern-value">{patternSummary}</p>
          {/if}
        </div>
      </section>

      {#if notes}
        <section class="detail-section notes-block">
          <p class="section-heading">
            <span class="material-symbols-outlined section-icon" aria-hidden="true">notes</span>
            <span>Notes</span>
          </p>
          <pre>{notes}</pre>
        </section>
      {/if}
    </div>
  {:else}
    <div class="empty-state align-start" class:tabbed-layout={isTabbedLayout}>
      <p>Select a track to inspect it.</p>
      <p>Playlist and library selections both surface their metadata here.</p>
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

  .details-content.tabbed-layout,
  .empty-state.tabbed-layout {
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

  .format-section {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .format-section .section-heading {
    flex: 0 0 auto;
  }

  .format-value {
    margin: 0;
    text-align: right;
    color: var(--text);
  }

  .format-detail {
    margin: 0;
    text-align: right;
    color: var(--muted);
  }

  .format-copy {
    display: grid;
    justify-items: end;
    gap: 0.18rem;
  }

  .pattern-value {
    margin: 0;
    text-align: right;
    color: var(--text);
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
