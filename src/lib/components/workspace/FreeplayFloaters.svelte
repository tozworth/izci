<script lang="ts">
  import { scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';
  import type { MultiplayerClient } from '$lib/services/multiplayer-types';
  import {
    createFreeplayFloaterPlacement,
    getFreeplayClientIcon,
    type FreeplayFloaterPlacement
  } from '$lib/services/now-playing-freeplay';

  export let clients: MultiplayerClient[] = [];
  export let size = 100;
  export let motion = 35;

  const sessionSeed = Math.floor(Math.random() * 0x7fffffff);
  let placements = new Map<string, FreeplayFloaterPlacement>();

  $: activeClients = clients.filter((client) =>
    client.status === 'connected'
    && client.freeplay
    && Boolean(client.freeplayTrack)
    && !['idle', 'ended', 'error'].includes(client.freeplayPlaybackState)
  );
  $: syncPlacements(activeClients);

  function syncPlacements(nextClients: MultiplayerClient[]): void {
    const ids = new Set(nextClients.map((client) => client.id));
    const next = new Map([...placements].filter(([id]) => ids.has(id)));
    let changed = next.size !== placements.size;
    nextClients.forEach((client, index) => {
      if (next.has(client.id)) return;
      next.set(client.id, createFreeplayFloaterPlacement(client.id, index, sessionSeed));
      changed = true;
    });
    if (changed) placements = next;
  }

  function placementStyle(placement: FreeplayFloaterPlacement): string {
    const motionFactor = motion / 100;
    return [
      `--float-offset: ${placement.offsetPercent}%`,
      `--float-drift-x: ${placement.driftX * motionFactor}px`,
      `--float-drift-y: ${placement.driftY * motionFactor}px`,
      `--float-rotation: ${placement.rotation * motionFactor}deg`,
      `--float-duration: ${placement.durationSeconds}s`,
      `--float-delay: ${placement.delaySeconds}s`,
      `--float-scale: ${size / 100}`
    ].join('; ');
  }
</script>

<div class="freeplay-floaters" aria-live="polite">
  {#each activeClients as client (client.id)}
    {@const placement = placements.get(client.id)}
    {#if placement && client.freeplayTrack}
      <div
        class="freeplay-floater-anchor edge-{placement.edge}"
        style={placementStyle(placement)}
        transition:scale={{ duration: 420, start: 0.72, easing: cubicOut }}
      >
        <article class="freeplay-floater">
          <div class="freeplay-floater-artwork" aria-hidden="true">
            {#if client.freeplayArtworkUrl}
              <img src={client.freeplayArtworkUrl} alt="" />
            {:else}
              <span class="material-symbols-outlined">album</span>
            {/if}
          </div>
          <div class="freeplay-floater-copy">
            <div class="freeplay-floater-client">
              <span class="material-symbols-outlined" aria-hidden="true">{getFreeplayClientIcon(client.platform)}</span>
              <strong>{client.name}</strong>
            </div>
            <span class="freeplay-floater-title">{getTrackDisplayTitle(client.freeplayTrack)}</span>
            {#if getTrackDisplaySubtitle(client.freeplayTrack)}
              <span class="freeplay-floater-artist">{getTrackDisplaySubtitle(client.freeplayTrack)}</span>
            {/if}
          </div>
        </article>
      </div>
    {/if}
  {/each}
</div>

<style>
  .freeplay-floaters { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; }
  .freeplay-floater-anchor { position: absolute; transform-origin: center; }
  .edge-left { left: .75rem; top: var(--float-offset); }
  .edge-right { right: .75rem; top: var(--float-offset); }
  .edge-top { top: 3rem; left: var(--float-offset); }
  .edge-bottom { bottom: 1rem; left: var(--float-offset); }
  .freeplay-floater {
    display: grid; grid-template-columns: 4.1rem minmax(0, 1fr); gap: .65rem;
    width: 15rem; min-height: 4.1rem; padding: .42rem; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--border-strong) 76%, transparent);
    border-radius: .8rem; color: var(--text);
    background: color-mix(in srgb, var(--bg-elevated) 87%, transparent);
    box-shadow: 0 .35rem 1.1rem #0003;
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    transform: scale(var(--float-scale));
    animation: freeplay-float var(--float-duration) ease-in-out var(--float-delay) infinite alternate;
  }
  .freeplay-floater-artwork { display: grid; place-items: center; width: 4.1rem; height: 4.1rem; overflow: hidden; border-radius: .55rem; background: var(--bg); color: var(--text-muted); }
  .freeplay-floater-artwork img { width: 100%; height: 100%; object-fit: cover; }
  .freeplay-floater-artwork .material-symbols-outlined { font-size: 2rem; }
  .freeplay-floater-copy { min-width: 0; align-self: center; display: flex; flex-direction: column; gap: .12rem; }
  .freeplay-floater-client { display: flex; align-items: center; gap: .28rem; min-width: 0; color: var(--accent); font-size: .72rem; }
  .freeplay-floater-client .material-symbols-outlined { flex: 0 0 auto; font-size: .95rem; }
  .freeplay-floater-client strong, .freeplay-floater-title, .freeplay-floater-artist { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .freeplay-floater-title { font-size: .82rem; font-weight: 650; }
  .freeplay-floater-artist { color: var(--text-muted); font-size: .72rem; }
  @keyframes freeplay-float {
    from { translate: calc(var(--float-drift-x) * -1) calc(var(--float-drift-y) * -1); rotate: calc(var(--float-rotation) * -1); }
    to { translate: var(--float-drift-x) var(--float-drift-y); rotate: var(--float-rotation); }
  }
  @media (max-width: 900px) {
    .freeplay-floater { width: 12rem; grid-template-columns: 3.25rem minmax(0, 1fr); min-height: 3.25rem; }
    .freeplay-floater-artwork { width: 3.25rem; height: 3.25rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .freeplay-floater { animation: none; }
  }
</style>
