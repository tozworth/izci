<script lang="ts">
  import { formatBytes, formatDuration } from '$lib/utils/files';
  import type { PlaylistItem } from '$lib/types';

  export let track: PlaylistItem | null = null;
</script>

<section class="panel details-panel">
  <div class="panel-header">
    <p class="eyebrow">Current Song</p>
  </div>

  {#if track}
    <dl class="details-grid">
      <div>
        <dt>Format</dt>
        <dd>{track.extension.toUpperCase()}</dd>
      </div>
      <div>
        <dt>Engine</dt>
        <dd>{track.kind === 'module' ? 'Chiptune3 / libopenmpt AudioWorklet' : 'Howler / Web Audio'}</dd>
      </div>
      <div>
        <dt>File Size</dt>
        <dd>{formatBytes(track.size)}</dd>
      </div>
      <div>
        <dt>Duration</dt>
        <dd>{formatDuration(track.metadata?.duration ?? 0)}</dd>
      </div>
      <div>
        <dt>Artist</dt>
        <dd>{track.metadata?.artist || 'Unknown'}</dd>
      </div>
      <div>
        <dt>Tracker</dt>
        <dd>{track.metadata?.trackerType || (track.kind === 'module' ? 'Pending metadata' : 'N/A')}</dd>
      </div>
      <div>
        <dt>Patterns</dt>
        <dd>{track.metadata?.patterns ?? (track.kind === 'module' ? 'Pending playback' : 'N/A')}</dd>
      </div>
      <div class="details-span">
        <dt>Notes</dt>
        <dd>
          {track.kind === 'module'
            ? track.metadata?.message || 'Tracker seeking is enabled through Chiptune3 position control once playback has initialized.'
            : track.metadata?.message || 'Module metadata and richer tags can be expanded after the MVP.'}
        </dd>
      </div>
    </dl>
  {:else}
    <div class="empty-state align-start">
      <p>Select or drop a file to inspect it.</p>
      <p>The center area is intentionally reserved for a future visualization or workspace surface.</p>
    </div>
  {/if}
</section>
