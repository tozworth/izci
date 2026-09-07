<script lang="ts">
  import { onDestroy } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';
  import type { MultiplayerClient } from '$lib/services/multiplayer-types';
  import {
    createMultiplayerFloaterPlacement,
    getMultiplayerClientIcon,
    isMultiplayerFloaterVisible,
    type MultiplayerFloaterPlacement
  } from '$lib/services/now-playing-multiplayer';

  export let clients: MultiplayerClient[] = [];
  export let size = 100;
  export let motion = 35;

  const sessionSeed = Math.floor(Math.random() * 0x7fffffff);
  let placements = new Map<string, MultiplayerFloaterPlacement>();
  let dragOffsets = new Map<string, { x: number; y: number }>();
  let dragState: {
    clientId: string;
    pointerId: number;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    minDeltaX: number;
    maxDeltaX: number;
    minDeltaY: number;
    maxDeltaY: number;
    node: HTMLElement;
    dragLayer: HTMLElement;
    lastPointerX: number;
    lastPointerY: number;
    lastPointerTime: number;
    velocityX: number;
    velocityY: number;
  } | null = null;
  let inertiaState: {
    clientId: string;
    dragLayer: HTMLElement;
    x: number;
    y: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    velocityX: number;
    velocityY: number;
    lastTime: number;
  } | null = null;
  let inertiaFrame: number | null = null;

  const INERTIA_RELEASE_FACTOR = 0.35;
  const INERTIA_FRICTION = 0.84;
  const INERTIA_STOP_SPEED = 0.02;
  const FLOATER_TRANSITION_DURATION = 420;
  const FLOATER_TRANSITION_START_SCALE = 0.72;

  function zoomFade(node: HTMLElement): {
    duration: number;
    easing: typeof cubicOut;
    css: (progress: number) => string;
  } {
    return {
      duration: FLOATER_TRANSITION_DURATION,
      easing: cubicOut,
      css: (progress) => [
        `opacity: ${progress}`,
        `transform: scale(calc(var(--float-scale) * ${FLOATER_TRANSITION_START_SCALE + (1 - FLOATER_TRANSITION_START_SCALE) * progress}))`
      ].join('; ')
    };
  }

  $: activeClients = clients.filter(isMultiplayerFloaterVisible);
  $: syncPlacements(activeClients);

  function syncPlacements(nextClients: MultiplayerClient[]): void {
    const ids = new Set(nextClients.map((client) => client.id));
    const next = new Map([...placements].filter(([id]) => ids.has(id)));
    for (const id of dragOffsets.keys()) {
      if (!ids.has(id)) dragOffsets.delete(id);
    }
    if (dragState && !ids.has(dragState.clientId)) {
      finishDrag();
    }
    if (inertiaState && !ids.has(inertiaState.clientId)) {
      stopInertia();
    }
    let changed = next.size !== placements.size;
    nextClients.forEach((client, index) => {
      if (next.has(client.id)) return;
      next.set(client.id, createMultiplayerFloaterPlacement(client.id, index, sessionSeed));
      changed = true;
    });
    if (changed) placements = next;
  }

  function placementStyle(clientId: string, placement: MultiplayerFloaterPlacement): string {
    const motionFactor = motion / 100;
    const dragOffset = dragOffsets.get(clientId) ?? { x: 0, y: 0 };
    return [
      `--float-offset: ${placement.offsetPercent}%`,
      `--float-drift-x: ${placement.driftX * motionFactor}px`,
      `--float-drift-y: ${placement.driftY * motionFactor}px`,
      `--float-rotation: ${placement.rotation * motionFactor}deg`,
      `--float-duration: ${placement.durationSeconds}s`,
      `--float-delay: ${placement.delaySeconds}s`,
      `--float-drag-x: ${dragOffset.x}px`,
      `--float-drag-y: ${dragOffset.y}px`,
      `--float-scale: ${size / 100}`
    ].join('; ');
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function setDragOffset(clientId: string, dragLayer: HTMLElement, x: number, y: number): void {
    dragOffsets.set(clientId, { x, y });
    dragLayer.style.setProperty('--float-drag-x', `${x}px`);
    dragLayer.style.setProperty('--float-drag-y', `${y}px`);
  }

  function stopInertia(): void {
    if (inertiaFrame !== null) {
      cancelAnimationFrame(inertiaFrame);
      inertiaFrame = null;
    }
    inertiaState?.dragLayer.classList.remove('is-inertial');
    inertiaState = null;
  }

  function finishDrag(): typeof dragState {
    if (!dragState) return null;

    const state = dragState;
    state.node.classList.remove('is-dragging');
    state.dragLayer.classList.remove('is-dragging');
    if (state.node.hasPointerCapture(state.pointerId)) {
      state.node.releasePointerCapture(state.pointerId);
    }
    dragState = null;
    return state;
  }

  function advanceInertia(timestamp: number): void {
    inertiaFrame = null;
    const state = inertiaState;
    if (!state) return;

    const elapsed = Math.min(32, Math.max(1, timestamp - state.lastTime));
    state.lastTime = timestamp;
    let nextX = state.x + state.velocityX * elapsed;
    let nextY = state.y + state.velocityY * elapsed;
    if (nextX < state.minX || nextX > state.maxX) {
      nextX = clamp(nextX, state.minX, state.maxX);
      state.velocityX = 0;
    }
    if (nextY < state.minY || nextY > state.maxY) {
      nextY = clamp(nextY, state.minY, state.maxY);
      state.velocityY = 0;
    }

    const friction = Math.pow(INERTIA_FRICTION, elapsed / 16.67);
    state.velocityX *= friction;
    state.velocityY *= friction;
    state.x = nextX;
    state.y = nextY;
    setDragOffset(state.clientId, state.dragLayer, nextX, nextY);

    if (Math.max(Math.abs(state.velocityX), Math.abs(state.velocityY)) <= INERTIA_STOP_SPEED) {
      stopInertia();
      return;
    }
    inertiaFrame = requestAnimationFrame(advanceInertia);
  }

  function startInertia(state: NonNullable<typeof dragState>): void {
    const offset = dragOffsets.get(state.clientId);
    const velocityX = state.velocityX * INERTIA_RELEASE_FACTOR;
    const velocityY = state.velocityY * INERTIA_RELEASE_FACTOR;
    if (!offset || Math.max(Math.abs(velocityX), Math.abs(velocityY)) <= INERTIA_STOP_SPEED) return;

    stopInertia();
    inertiaState = {
      clientId: state.clientId,
      dragLayer: state.dragLayer,
      x: offset.x,
      y: offset.y,
      minX: state.startOffsetX + state.minDeltaX,
      maxX: state.startOffsetX + state.maxDeltaX,
      minY: state.startOffsetY + state.minDeltaY,
      maxY: state.startOffsetY + state.maxDeltaY,
      velocityX,
      velocityY,
      lastTime: performance.now()
    };
    state.dragLayer.classList.add('is-inertial');
    inertiaFrame = requestAnimationFrame(advanceInertia);
  }

  function handlePointerDown(event: PointerEvent, clientId: string): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const node = event.currentTarget as HTMLElement;
    const dragLayer = node.parentElement;
    const container = node.closest('.multiplayer-floaters');
    if (!(container instanceof HTMLElement) || !(dragLayer instanceof HTMLElement)) return;

    stopInertia();
    const dragOffset = dragOffsets.get(clientId) ?? { x: 0, y: 0 };
    const nodeRect = node.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    finishDrag();
    const now = performance.now();
    dragState = {
      clientId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: dragOffset.x,
      startOffsetY: dragOffset.y,
      minDeltaX: containerRect.left - nodeRect.left,
      maxDeltaX: containerRect.right - nodeRect.right,
      minDeltaY: containerRect.top - nodeRect.top,
      maxDeltaY: containerRect.bottom - nodeRect.bottom,
      node,
      dragLayer,
      lastPointerX: event.clientX,
      lastPointerY: event.clientY,
      lastPointerTime: now,
      velocityX: 0,
      velocityY: 0
    };
    node.classList.add('is-dragging');
    dragLayer.classList.add('is-dragging');
    node.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const state = dragState;
    const deltaX = clamp(
      event.clientX - state.startX,
      state.minDeltaX,
      state.maxDeltaX
    );
    const deltaY = clamp(
      event.clientY - state.startY,
      state.minDeltaY,
      state.maxDeltaY
    );
    const x = state.startOffsetX + deltaX;
    const y = state.startOffsetY + deltaY;
    const now = performance.now();
    const elapsed = Math.max(1, now - state.lastPointerTime);
    const velocityWeight = Math.min(0.45, elapsed / 50);
    state.velocityX = state.velocityX * (1 - velocityWeight)
      + (event.clientX - state.lastPointerX) / elapsed * velocityWeight;
    state.velocityY = state.velocityY * (1 - velocityWeight)
      + (event.clientY - state.lastPointerY) / elapsed * velocityWeight;
    state.lastPointerX = event.clientX;
    state.lastPointerY = event.clientY;
    state.lastPointerTime = now;
    setDragOffset(state.clientId, state.dragLayer, x, y);
    event.preventDefault();
    event.stopPropagation();
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const state = finishDrag();
    if (state) startInertia(state);
  }

  onDestroy(() => {
    stopInertia();
    finishDrag();
  });
</script>

<svelte:window on:pointerup={handlePointerUp} on:pointercancel={handlePointerUp} />

<div class="multiplayer-floaters" aria-live="polite">
  {#each activeClients as client (client.id)}
    {@const placement = placements.get(client.id)}
    {#if placement}
      <div
        class="multiplayer-floater-anchor edge-{placement.edge}"
        class:is-coop={!client.freeplay}
        style={placementStyle(client.id, placement)}
      >
        <div class="multiplayer-floater-drag-layer">
          <div class="multiplayer-floater-backdrop" aria-hidden="true"></div>
          <article
            class="multiplayer-floater"
            class:is-coop={!client.freeplay}
            transition:zoomFade|global
            on:pointerdown={(event) => handlePointerDown(event, client.id)}
            on:pointermove={handlePointerMove}
            on:pointerup={handlePointerUp}
            on:pointercancel={handlePointerUp}
            on:dragstart|preventDefault
          >
            {#if client.freeplay && client.freeplayTrack}
              <div class="multiplayer-floater-artwork" aria-hidden="true">
                {#if client.freeplayArtworkUrl}
                  <img src={client.freeplayArtworkUrl} alt="" />
                {:else}
                  <span class="material-symbols-outlined">album</span>
                {/if}
              </div>
              <div class="multiplayer-floater-copy">
                <div class="multiplayer-floater-client">
                  <span class="material-symbols-outlined" aria-hidden="true">{getMultiplayerClientIcon(client.platform)}</span>
                  <strong>{client.name}</strong>
                </div>
                <span class="multiplayer-floater-title">{getTrackDisplayTitle(client.freeplayTrack)}</span>
                {#if getTrackDisplaySubtitle(client.freeplayTrack)}
                  <span class="multiplayer-floater-artist">{getTrackDisplaySubtitle(client.freeplayTrack)}</span>
                {/if}
              </div>
            {:else}
              <div class="multiplayer-floater-client">
                <span class="material-symbols-outlined" aria-hidden="true">{getMultiplayerClientIcon(client.platform)}</span>
                <strong>{client.name}</strong>
              </div>
            {/if}
          </article>
        </div>
      </div>
    {/if}
  {/each}
</div>

<style>
  .multiplayer-floaters { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; }
  .multiplayer-floater-anchor {
    position: absolute; transform-origin: center; pointer-events: auto; touch-action: none;
  }
  .multiplayer-floater-drag-layer {
    position: relative;
    transform: translate3d(var(--float-drag-x), var(--float-drag-y), 0);
    animation: multiplayer-float var(--float-duration) ease-in-out var(--float-delay) infinite alternate;
  }
  .multiplayer-floater-drag-layer.is-dragging {
    animation-play-state: paused;
  }
  .multiplayer-floater-drag-layer.is-dragging,
  .multiplayer-floater-drag-layer.is-inertial { will-change: transform; }
  .edge-left { left: .75rem; top: var(--float-offset); }
  .edge-right { right: .75rem; top: var(--float-offset); }
  .edge-top { top: 3rem; left: var(--float-offset); }
  .edge-bottom { bottom: 1rem; left: var(--float-offset); }
  .multiplayer-floater-backdrop {
    position: absolute; inset: 0; z-index: 0; transform: scale(var(--float-scale));
    border: 1px solid color-mix(in srgb, var(--border-strong) 76%, transparent);
    border-radius: .8rem;
    background: color-mix(in srgb, var(--bg-elevated) 87%, transparent);
    box-shadow: 0 .35rem 1.1rem #0003;
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    pointer-events: none;
  }
  .multiplayer-floater-anchor.is-coop .multiplayer-floater-backdrop { border-radius: .65rem; }
  .multiplayer-floater {
    position: relative; z-index: 1;
    display: grid; grid-template-columns: 4.1rem minmax(0, 1fr); gap: .65rem;
    width: 15rem; min-height: 4.1rem; padding: .42rem; box-sizing: border-box;
    border-radius: .8rem; color: var(--text);
    background: transparent;
    transform: scale(var(--float-scale));
    cursor: grab;
    user-select: none;
  }
  .multiplayer-floater.is-dragging { cursor: grabbing; }
  .multiplayer-floater.is-coop {
    display: flex; align-items: center; width: max-content; max-width: 9rem; min-height: 0;
    padding: .32rem .48rem; border-radius: .65rem;
  }
  .multiplayer-floater.is-coop .multiplayer-floater-client { font-size: .68rem; }
  .multiplayer-floater.is-coop .multiplayer-floater-client .material-symbols-outlined { font-size: .85rem; }
  .multiplayer-floater-artwork { display: grid; place-items: center; width: 4.1rem; height: 4.1rem; overflow: hidden; border-radius: .55rem; background: var(--bg); color: var(--text-muted); }
  .multiplayer-floater-artwork img { width: 100%; height: 100%; object-fit: cover; }
  .multiplayer-floater-artwork .material-symbols-outlined { font-size: 2rem; }
  .multiplayer-floater-copy { min-width: 0; align-self: center; display: flex; flex-direction: column; gap: .12rem; }
  .multiplayer-floater-client { display: flex; align-items: center; gap: .28rem; min-width: 0; color: var(--accent); font-size: .72rem; }
  .multiplayer-floater-client .material-symbols-outlined { flex: 0 0 auto; font-size: .95rem; }
  .multiplayer-floater-client strong, .multiplayer-floater-title, .multiplayer-floater-artist { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .multiplayer-floater-title { font-size: .82rem; font-weight: 650; }
  .multiplayer-floater-artist { color: var(--text-muted); font-size: .72rem; }
  @keyframes multiplayer-float {
    from { translate: calc(var(--float-drift-x) * -1) calc(var(--float-drift-y) * -1); rotate: calc(var(--float-rotation) * -1); }
    to { translate: var(--float-drift-x) var(--float-drift-y); rotate: var(--float-rotation); }
  }
  @media (max-width: 900px) {
    .multiplayer-floater { width: 12rem; grid-template-columns: 3.25rem minmax(0, 1fr); min-height: 3.25rem; }
    .multiplayer-floater-artwork { width: 3.25rem; height: 3.25rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .multiplayer-floater-drag-layer { animation: none; }
  }
</style>
