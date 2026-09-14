<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { PlaybackSnapshot, TrackItem } from '$lib/types';
  import {
    findWaterfallFocus,
    initialWaterfallFocus,
    waterfallCardFocusId,
    waterfallSectionFocusId,
    type OdaWaterfallSection
  } from '../oda-navigation';
  import type { OdaCardModel, OdaHomeSectionModel } from '../oda-destinations';
  import type { OdaTranslate } from '../oda-translate';
  import { getOdaQueueCountSummary } from '../oda-queue';

  export let sections: OdaHomeSectionModel[];
  export let focusId: string | null = null;
  export let translate: OdaTranslate;
  export let playingTrack: TrackItem | null = null;
  export let playbackSnapshot: PlaybackSnapshot | null = null;
  export let artworkUrl: string | null = null;
  export let queueItems: TrackItem[] = [];

  $: queueSummary = getOdaQueueCountSummary(queueItems, translate);

  export let onActivate: (card: OdaCardModel) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

  // The focused section stays vertically centered: the track is translated so
  // the focused section's middle lands on the viewport middle, with the
  // slide animated by CSS. Transforms don't affect layout, so measuring
  // stays stable while the transition runs.
  let viewport: HTMLElement | null = null;
  let track: HTMLElement | null = null;
  let translateY = 0;
  let centerReady = false;

  function centerFocused(): void {
    if (!viewport || !track) return;
    const focusedElement = track.querySelector(
      ':scope > .oda-waterfall-section.is-focused'
    ) as HTMLElement | null;
    if (!focusedElement) return;
    const next = viewport.clientHeight / 2
      - (focusedElement.offsetTop + focusedElement.offsetHeight / 2);
    if (centerReady && Math.abs(next - translateY) < 0.5) return;
    translateY = next;
    centerReady = true;
  }

  $: if (viewport && track) {
    void focusedSectionIndex;
    void sections;
    void tick().then(centerFocused);
  }

  onMount(() => {
    centerFocused();
    if (typeof ResizeObserver === 'undefined' || !viewport || !track) return;
    const observer = new ResizeObserver(() => centerFocused());
    observer.observe(viewport);
    observer.observe(track);
    return () => observer.disconnect();
  });

  $: waterfallSections = sections.map((section): OdaWaterfallSection => ({
    id: section.id,
    cardIds: section.cards.map((card) => card.id)
  }));
  $: focused = findWaterfallFocus(focusId, waterfallSections) ?? initialWaterfallFocus(waterfallSections);
  $: focusedSectionIndex = focused.sectionIndex;
  $: focusedCardId = focused.onCards
    ? waterfallCardFocusId(
        sections[focusedSectionIndex]?.id ?? '',
        sections[focusedSectionIndex]?.cards[focused.cardIndex]?.id ?? ''
      )
    : waterfallSectionFocusId(sections[focusedSectionIndex]?.id ?? '');

  // The card row never wraps, so keep the focused card visible: scroll it
  // into view with room to spare for the row's end fade (see scroll-margin
  // in oda.css). `nearest` leaves already-visible cards untouched.
  let cardRow: HTMLElement | null = null;

  function revealFocusedCard(): void {
    const card = cardRow?.querySelector(':scope > .oda-card.is-focused') as HTMLElement | null;
    if (!card) return;
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
  }

  $: if (cardRow) {
    void focusedCardId;
    void tick().then(revealFocusedCard);
  }

  function nowPlayingSubtext(): string {
    const artist = playingTrack?.metadata?.artist?.trim();
    if (artist) return artist;
    return playStateLabel();
  }

  function playStateLabel(): string {
    if (!playingTrack) return translate('oda.home.idle', 'Nothing playing');
    if (playbackSnapshot?.state === 'playing') return translate('oda.home.playing', 'Playing');
    if (playbackSnapshot?.state === 'paused') return translate('oda.home.paused', 'Paused');
    return translate('oda.home.idle', 'Nothing playing');
  }

  function cardFocusId(sectionId: string, cardId: string): string {
    return waterfallCardFocusId(sectionId, cardId);
  }

  /** Decorative corner glyph per card; null renders no glyph. */
  const CARD_GLYPHS: Record<string, string> = {
    'browse-images': 'image',
    'browse-videos': 'movie',
    'browse-music': 'library_music',
    artists: 'mic',
    albums: 'album',
    songs: 'music_note',
    genres: 'category',
    years: 'calendar_month',
    formats: 'audio_file',
    folders: 'folder',
    'now-playing': 'graphic_eq',
    queue: 'queue_music',
    'browse-recents': 'history',
    'all-options': 'settings',
    'exit-oda': 'logout'
  };

  function cardGlyph(cardId: string): string | null {
    return CARD_GLYPHS[cardId] ?? null;
  }
</script>

<div class="oda-waterfall" bind:this={viewport}>
  <div
    class="oda-waterfall-track"
    class:center-ready={centerReady}
    bind:this={track}
    style:transform={`translate3d(0, ${translateY}px, 0)`}
  >
  {#each sections as section, index (section.id)}
    <section
      class="oda-waterfall-section"
      class:is-focused={index === focusedSectionIndex}
      aria-hidden={index !== focusedSectionIndex}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
      <h2
        class="oda-waterfall-header"
        on:click={() => onFocus(waterfallSectionFocusId(section.id))}
      >{translate(section.labelKey, section.labelFallback)}</h2>

      {#if index === focusedSectionIndex}
        <div class="oda-card-row" bind:this={cardRow}>
          {#each section.cards as card (card.id)}
            {@const cardId = cardFocusId(section.id, card.id)}
            {#if section.id === 'now-playing' && card.id === 'now-playing'}
              <button
                type="button"
                class="oda-card"
                class:has-art={!!artworkUrl}
                class:is-focused={focusedCardId === cardId}
                class:is-empty={!playingTrack}
                style={artworkUrl ? `background-image: url("${artworkUrl}")` : ''}
                on:click={() => { onFocus(cardId); onActivate(card); }}
              >
                {#if cardGlyph(card.id)}
                  <span class="oda-card-glyph material-symbols-outlined" aria-hidden="true">{cardGlyph(card.id)}</span>
                {/if}
                <span class="oda-card-strip">
                  <span class="oda-card-label">
                    {playingTrack ? (playingTrack.metadata?.title || playingTrack.name) : translate('oda.cards.nowPlaying', 'Now Playing')}
                  </span>
                  <span class="oda-card-meta">
                    {nowPlayingSubtext()}
                  </span>
                </span>
              </button>
            {:else}
              <button
                type="button"
                class="oda-card"
                class:is-focused={focusedCardId === cardId}
                class:is-empty={card.empty}
                on:click={() => { onFocus(cardId); onActivate(card); }}
              >
                {#if cardGlyph(card.id)}
                  <span class="oda-card-glyph material-symbols-outlined" aria-hidden="true">{cardGlyph(card.id)}</span>
                {/if}
                <span class="oda-card-label">{translate(card.labelKey, card.labelFallback)}</span>
                {#if card.id === 'queue'}
                  <span class="oda-card-meta">{queueSummary}</span>
                {:else if card.count !== undefined}
                  <span class="oda-card-meta">
                    {card.count === 1
                      ? translate('oda.home.countOne', '1 item')
                      : translate('oda.home.count', '{count} items', { count: card.count })}
                  </span>
                {/if}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  {/each}
  </div>
</div>
