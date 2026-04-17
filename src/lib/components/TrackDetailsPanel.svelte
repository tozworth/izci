<script lang="ts">
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import type { PlaylistItem } from '$lib/types';
  import { resolveModuleDisplayFormat, resolveModuleTrackerName } from '$lib/utils/files';

  export let track: PlaylistItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let hideEyebrow = false;
  export let isTabbedLayout = false;
  export let fillParent = false;
  export let showCloseButton = false;
  export let onClose: () => void = () => {};

  $: title = track?.metadata?.title?.trim() || '';
  $: showTrackSection = title.length > 0;
  $: artist = track?.metadata?.artist?.trim() || '';
  $: showArtist = showTrackSection && artist.length > 0 && artist.toLowerCase() !== 'unknown';
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

<section class="panel details-panel" class:fill-parent={fillParent}>
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
          <p class="section-heading">
            <span class="material-symbols-outlined section-icon" aria-hidden="true">audio_file</span>
            <span>Track</span>
          </p>
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
  .details-panel.fill-parent {
    width: 100%;
    min-width: 0;
    height: 100%;
  }

  .details-close-button {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.22rem;
    min-width: 5.75rem;
    padding: 0.1rem 0;
    color: var(--muted);
    background: transparent;
    cursor: pointer;
    transition: color 160ms ease;
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
    transition:
      max-width 160ms ease,
      opacity 160ms ease;
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
    padding: 0 0.9rem;
  }

  .details-content.tabbed-layout,
  .empty-state.tabbed-layout {
    padding-bottom: calc(7rem + env(safe-area-inset-bottom, 0px));
  }

  .detail-section {
    display: grid;
    gap: 0.35rem;
    padding: 0.95rem 0;
  }

  .detail-section:first-child {
    padding-top: 0;
  }

  .detail-section + .detail-section {
    border-top: 1px solid var(--border-soft);
  }

  .track-copy {
    gap: 0.28rem;
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
    gap: 0.45rem;
    margin: 0;
    font-size: 0.95rem;
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
    font-size: 1.45rem;
    line-height: 1.1;
    font-weight: 700;
  }

  .track-artist {
    margin: 0;
    color: var(--muted);
    font-size: 0.98rem;
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
