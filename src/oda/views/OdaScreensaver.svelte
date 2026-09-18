<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { materializeTrackItem } from '$lib/stores/queue-materialization';
  import type { TrackItem } from '$lib/types';
  import { getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';
  import { randomScreensaverOffset, shuffleScreensaverItems } from '../oda-screensaver';

  interface ScreenImage {
    track: TrackItem;
    url: string;
    owned: boolean;
  }

  export let active = false;
  export let imageItems: TrackItem[] = [];
  export let playingTrack: TrackItem | null = null;
  export let moveIntervalMinutes = 0;

  const IMAGE_DURATION_MS = 25_000;
  const IMAGE_FADE_MS = 4_000;
  const TEXT_FADE_MS = 1_200;

  let mounted = false;
  let running = false;
  let imageKey = '';
  let loadToken = 0;
  let queue: TrackItem[] = [];
  let previousTrack: TrackItem | undefined;
  let imageA: ScreenImage | null = null;
  let imageB: ScreenImage | null = null;
  let frontSlot: 'a' | 'b' = 'a';
  let imageTimer: ReturnType<typeof setTimeout> | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let moveTimer: ReturnType<typeof setInterval> | null = null;
  let moveFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let now = new Date();
  let textVisible = true;
  let clockX = 0;
  let clockY = 0;
  let trackX = 0;
  let trackY = 0;

  $: title = playingTrack ? getTrackDisplayTitle(playingTrack) || playingTrack.name : '';
  $: artist = getTrackDisplaySubtitle(playingTrack);
  $: timeText = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit'
  }).format(now);
  $: dateText = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  }).format(now);

  function releaseImage(image: ScreenImage | null): void {
    if (image?.owned) URL.revokeObjectURL(image.url);
  }

  function clearTimer(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null): void {
    if (timer !== null) clearTimeout(timer);
  }

  async function loadImage(track: TrackItem, token: number): Promise<ScreenImage | null> {
    let url = track.objectUrl;
    let owned = false;
    if (!url && track.file) {
      url = URL.createObjectURL(track.file);
      owned = true;
    } else if (!url) {
      const materialized = await materializeTrackItem(track, false).catch(() => null);
      url = materialized?.objectUrl;
      owned = Boolean(url);
    }
    if (!url || token !== loadToken) {
      if (url && owned) URL.revokeObjectURL(url);
      return null;
    }

    const probe = new Image();
    probe.decoding = 'async';
    probe.src = url;
    try {
      await probe.decode();
    } catch {
      if (!probe.complete || probe.naturalWidth === 0) {
        if (owned) URL.revokeObjectURL(url);
        return null;
      }
    }
    if (token !== loadToken) {
      if (owned) URL.revokeObjectURL(url);
      return null;
    }
    return { track, url, owned };
  }

  function refillQueue(): void {
    queue = shuffleScreensaverItems(imageItems, Math.random, previousTrack);
  }

  async function showNextImage(): Promise<void> {
    const token = loadToken;
    if (queue.length === 0) refillQueue();

    let next: ScreenImage | null = null;
    let attempts = queue.length;
    while (!next && attempts > 0 && token === loadToken) {
      const track = queue.shift();
      if (!track) break;
      attempts -= 1;
      next = await loadImage(track, token);
    }

    if (token !== loadToken) {
      releaseImage(next);
      return;
    }

    if (next) {
      previousTrack = next.track;
      if (!imageA && !imageB) {
        imageA = next;
        frontSlot = 'a';
      } else {
        const oldSlot = frontSlot;
        if (oldSlot === 'a') imageB = next;
        else imageA = next;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (token !== loadToken) return;
          frontSlot = oldSlot === 'a' ? 'b' : 'a';
        }));
        clearTimer(releaseTimer);
        releaseTimer = setTimeout(() => {
          if (oldSlot === 'a') {
            releaseImage(imageA);
            imageA = null;
          } else {
            releaseImage(imageB);
            imageB = null;
          }
        }, IMAGE_FADE_MS + 250);
      }
    }

    imageTimer = setTimeout(() => void showNextImage(), IMAGE_DURATION_MS);
  }

  function relocateText(): void {
    textVisible = false;
    clearTimer(moveFadeTimer);
    moveFadeTimer = setTimeout(() => {
      clockX = randomScreensaverOffset();
      clockY = randomScreensaverOffset();
      trackX = randomScreensaverOffset();
      trackY = randomScreensaverOffset();
      textVisible = true;
    }, TEXT_FADE_MS);
  }

  function scheduleTextMovement(): void {
    clearTimer(moveTimer);
    moveTimer = null;
    if (moveIntervalMinutes > 0) {
      moveTimer = setInterval(relocateText, moveIntervalMinutes * 60_000);
    }
  }

  function stop(): void {
    running = false;
    loadToken += 1;
    clearTimer(imageTimer);
    clearTimer(releaseTimer);
    clearTimer(clockTimer);
    clearTimer(moveTimer);
    clearTimer(moveFadeTimer);
    imageTimer = null;
    releaseTimer = null;
    clockTimer = null;
    moveTimer = null;
    moveFadeTimer = null;
    releaseImage(imageA);
    releaseImage(imageB);
    imageA = null;
    imageB = null;
    queue = [];
    previousTrack = undefined;
    textVisible = true;
  }

  function reconcile(nextActive: boolean, items: TrackItem[]): void {
    const nextImageKey = items.map((item) => `${item.id}:${item.lastModified}`).join('|');
    if (!nextActive) {
      if (running) stop();
      return;
    }
    if (running && nextImageKey === imageKey) return;
    if (running) stop();
    running = true;
    imageKey = nextImageKey;
    loadToken += 1;
    now = new Date();
    clockTimer = setInterval(() => { now = new Date(); }, 15_000);
    scheduleTextMovement();
    void showNextImage();
  }

  $: if (mounted) reconcile(active, imageItems);
  $: if (mounted && running) {
    void moveIntervalMinutes;
    scheduleTextMovement();
  }

  onMount(() => {
    mounted = true;
    reconcile(active, imageItems);
  });

  onDestroy(stop);
</script>

{#if active}
  <section class="oda-screensaver" aria-label="Screensaver">
    <div class="oda-screensaver-theme" aria-hidden="true"></div>
    {#if imageA}
      <img class:visible={frontSlot === 'a'} src={imageA.url} alt="" />
    {/if}
    {#if imageB}
      <img class:visible={frontSlot === 'b'} src={imageB.url} alt="" />
    {/if}
    <div class="oda-screensaver-shade" aria-hidden="true"></div>
    <div
      class="oda-screensaver-clock"
      class:visible={textVisible}
      style={`--move-x: ${4 + clockX * 0.12}%; --move-y: ${4 + clockY * 0.12}%`}
    >
      <time datetime={now.toISOString()}>{timeText}</time>
      <span>{dateText}</span>
    </div>
    {#if title}
      <div
        class="oda-screensaver-track"
        class:visible={textVisible}
        style={`--move-x: ${4 + trackX * 0.12}%; --move-y: ${5 + trackY * 0.12}%`}
      >
        <strong>{title}</strong>
        {#if artist}<span>{artist}</span>{/if}
      </div>
    {/if}
  </section>
{/if}
