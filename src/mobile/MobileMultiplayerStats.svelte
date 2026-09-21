<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { MULTIPLAYER_PROTOCOL_MAJOR, MULTIPLAYER_PROTOCOL_MINOR, formatHostImplementation, type MultiplayerImplementation } from '$lib/services/multiplayer-protocol';
  import {
    formatAudioStat,
    formatBytes,
    formatConnectionStat,
    formatPacketLoss,
    formatTimingStat
  } from '$lib/services/menu-format';
  import type {
    MultiplayerConnectionStats,
    MultiplayerConnectionStatus
  } from '$lib/services/multiplayer-types';
  import type { MultiplayerConnectionRoute } from '$lib/services/multiplayer-ice';

  export let hostName: string | null = null;
  export let hostVersion: string | null = null;
  export let hostImplementation: MultiplayerImplementation | null = null;
  export let hostProtocol: { major: number; minor: number } | null = null;
  export let connectionStatus: MultiplayerConnectionStatus = 'idle';
  export let connectionRoute: MultiplayerConnectionRoute | null = null;
  export let audioBitrateKbps: number | null = null;
  export let receiveAudio = true;
  export let freeplay = false;
  export let connectionStats: MultiplayerConnectionStats | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  const DISMISS_DRAG_PX = 110;
  let dragY = 0;
  let dragStart: { y: number; time: number } | null = null;
  let dragActive = false;

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      dispatch('close');
    }
  }

  function onDragStart(event: PointerEvent): void {
    if (dragActive) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragStart = { y: event.clientY, time: performance.now() };
    dragActive = true;
    dragY = 0;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onDragMove(event: PointerEvent): void {
    if (!dragActive || !dragStart) return;
    const delta = event.clientY - dragStart.y;
    dragY = delta > 0 ? delta : 0;
  }

  function onDragEnd(): void {
    if (!dragActive) return;
    dragActive = false;
    const start = dragStart;
    dragStart = null;
    if (!start) return;
    const elapsed = Math.max(1, performance.now() - start.time);
    if (dragY >= DISMISS_DRAG_PX || (dragY > 40 && dragY / elapsed > 0.6)) {
      dispatch('close');
    } else {
      dragY = 0;
    }
  }

  function onDragCancel(): void {
    dragActive = false;
    dragStart = null;
    dragY = 0;
  }

</script>

<svelte:window on:keydown={handleKeydown} />

<button
  class="mobile-stats-scrim"
  type="button"
  aria-label={$t('main.common.close', { default: 'Close' })}
  style:opacity={dragY > 0 ? Math.max(0.35, 1 - dragY / DISMISS_DRAG_PX) : null}
  on:click={() => dispatch('close')}
></button>

<div
  class="mobile-stats-sheet"
  class:is-dragging={dragActive}
  role="dialog"
  aria-modal="true"
  aria-label={$t('main.multiplayer.label', { default: 'Multiplayer' })}
  style:transform={dragY > 0 ? `translateY(${dragY}px)` : null}
>
  <div
    class="mobile-stats-drag-surface"
    role="group"
    aria-label={$t('main.multiplayer.label', { default: 'Multiplayer' })}
    on:pointerdown={onDragStart}
    on:pointermove={onDragMove}
    on:pointerup={onDragEnd}
    on:pointercancel={onDragCancel}
  >
    <div class="mobile-stats-grabber" aria-hidden="true"></div>
    <header class="mobile-stats-header">
      <span class="material-symbols-outlined" aria-hidden="true">{freeplay ? 'queue_music' : 'cast_connected'}</span>
      <div>
        <strong>{hostName ?? $t('main.multiplayer.connecting', { default: 'Connecting...' })}</strong>
        {#if freeplay}<small>{$t('main.multiplayer.freeplay.label', { default: 'Freeplay' })}</small>{/if}
      </div>
      <button type="button" aria-label={$t('main.common.close', { default: 'Close' })} on:click={() => dispatch('close')}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
  </div>

  <dl class="mobile-stats-rows">
    <div class="mobile-stats-row">
      <dt><span class="material-symbols-outlined" aria-hidden="true">info</span><span>{$t('main.multiplayer.stats.hostVersion', { default: 'Host' })}</span></dt>
      <dd>{(hostImplementation ?? hostVersion) ? `${formatHostImplementation(hostImplementation ?? (hostVersion ? { product: 'izci', productVersion: hostVersion } : null))} · ${$t('main.multiplayer.stats.protocol', { default: 'Protocol' })} ${hostProtocol ? `${hostProtocol.major}.${hostProtocol.minor}` : `${MULTIPLAYER_PROTOCOL_MAJOR}.${MULTIPLAYER_PROTOCOL_MINOR}`}` : '—'}</dd>
    </div>
    <div class="mobile-stats-row">
      <dt><span class="material-symbols-outlined" aria-hidden="true">route</span><span>{$t('main.multiplayer.stats.connection', { default: 'Connection' })}</span></dt>
      <dd>{formatConnectionStat(connectionStatus, connectionRoute, $t)}</dd>
    </div>
    <div class="mobile-stats-row">
      <dt><span class="material-symbols-outlined" aria-hidden="true">graphic_eq</span><span>{$t('main.multiplayer.stats.audio', { default: 'Audio' })}</span></dt>
      <dd>{formatAudioStat(receiveAudio, connectionStats, audioBitrateKbps, $t)}</dd>
    </div>
    <div class="mobile-stats-row">
      <dt><span class="material-symbols-outlined" aria-hidden="true">data_usage</span><span>{$t('main.multiplayer.stats.data', { default: 'Data' })}</span></dt>
      <dd>{formatBytes(connectionStats?.bytesReceived)}</dd>
    </div>
    <div class="mobile-stats-row">
      <dt><span class="material-symbols-outlined" aria-hidden="true">monitoring</span><span>{$t('main.multiplayer.stats.lossTotal', { default: 'Loss · total' })}</span></dt>
      <dd>{formatPacketLoss(connectionStats?.packetsLost, connectionStats?.packetsReceived, connectionStats?.packetLossPercent)}</dd>
    </div>
    <div class="mobile-stats-row">
      <dt><span class="material-symbols-outlined" aria-hidden="true">speed</span><span>{$t('main.multiplayer.stats.timing', { default: 'Jitter · RTT' })}</span></dt>
      <dd>{formatTimingStat(connectionStats)}</dd>
    </div>
  </dl>
</div>
