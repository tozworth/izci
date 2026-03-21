<script lang="ts">
  import type { PlaylistItem } from '$lib/types';
  import { resolveModuleTrackerName } from '$lib/utils/files';

  export let track: PlaylistItem | null = null;
  export let hideEyebrow = false;
  export let isTabbedLayout = false;
  export let fillParent = false;

  $: title = track?.metadata?.title?.trim() || '';
  $: showTrackSection = title.length > 0;
  $: artist = track?.metadata?.artist?.trim() || '';
  $: showArtist = showTrackSection && artist.length > 0 && artist.toLowerCase() !== 'unknown';
  $: tracker = track ? resolveModuleTrackerName(track.extension, track.metadata?.trackerType) : '';
  $: patterns = track?.metadata?.patterns;
  $: notes = track?.metadata?.message?.trim() || '';
  $: bitrate = track?.kind === 'stream' ? track.metadata?.bitrate : undefined;
  $: formatSummary = track
    ? track.kind === 'stream'
      ? [track.extension.toUpperCase(), bitrate ? `${bitrate} kbps` : ''].filter(Boolean).join(' ')
      : [track.extension.toUpperCase(), tracker ? `(${tracker})` : ''].filter(Boolean).join(' ')
    : '';
  $: patternSummary =
    track?.kind === 'module' && typeof patterns === 'number'
      ? `${patterns} pattern${patterns === 1 ? '' : 's'}`
      : '';
</script>

<section class="panel details-panel" class:fill-parent={fillParent}>
  <div class="panel-header">
    {#if !hideEyebrow}
      <p class="eyebrow">Track Details</p>
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
          <p class="format-value">{formatSummary}</p>
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
