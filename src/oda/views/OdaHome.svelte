<script lang="ts">
  import type { PlaybackSnapshot, TrackItem } from '$lib/types';
  import {
    findWaterfallFocus,
    INITIAL_WATERFALL_FOCUS,
    waterfallCardFocusId,
    waterfallSectionFocusId,
    type OdaWaterfallSection
  } from '../oda-navigation';
  import type { OdaCardModel, OdaHomeSectionModel } from '../oda-destinations';
  import type { OdaTranslate } from '../oda-translate';

  export let sections: OdaHomeSectionModel[];
  export let focusId: string | null = null;
  export let translate: OdaTranslate;
  export let playingTrack: TrackItem | null = null;
  export let playbackSnapshot: PlaybackSnapshot | null = null;
  export let artworkUrl: string | null = null;
  export let queueCount = 0;

  export let onActivate: (card: OdaCardModel) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

  $: waterfallSections = sections.map((section): OdaWaterfallSection => ({
    id: section.id,
    cardIds: section.cards.map((card) => card.id)
  }));
  $: focused = findWaterfallFocus(focusId, waterfallSections) ?? INITIAL_WATERFALL_FOCUS;
  $: focusedSectionIndex = focused.sectionIndex;
  $: focusedCardId = focused.onCards
    ? waterfallCardFocusId(
        sections[focusedSectionIndex]?.id ?? '',
        sections[focusedSectionIndex]?.cards[focused.cardIndex]?.id ?? ''
      )
    : waterfallSectionFocusId(sections[focusedSectionIndex]?.id ?? '');

  function playStateLabel(): string {
    if (!playingTrack) return translate('oda.home.idle', 'Nothing playing');
    if (playbackSnapshot?.state === 'playing') return translate('oda.home.playing', 'Playing');
    if (playbackSnapshot?.state === 'paused') return translate('oda.home.paused', 'Paused');
    return translate('oda.home.idle', 'Nothing playing');
  }

  function cardFocusId(sectionId: string, cardId: string): string {
    return waterfallCardFocusId(sectionId, cardId);
  }
</script>

<div class="oda-waterfall">
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
        <div class="oda-card-row">
          {#each section.cards as card (card.id)}
            {@const cardId = cardFocusId(section.id, card.id)}
            {#if section.id === 'now-playing' && card.id === 'now-playing'}
              <button
                type="button"
                class="oda-card oda-now-playing-card"
                class:is-focused={focusedCardId === cardId}
                class:is-empty={!playingTrack}
                on:click={() => { onFocus(cardId); onActivate(card); }}
              >
                <span
                  class="oda-now-playing-art"
                  style={artworkUrl ? `background-image: url("${artworkUrl}")` : ''}
                  aria-hidden="true"
                >
                  {#if !artworkUrl}
                    <span class="material-symbols-outlined">music_note</span>
                  {/if}
                </span>
                <span>
                  <span class="oda-card-label">
                    {playingTrack ? (playingTrack.metadata?.title || playingTrack.name) : translate('oda.cards.nowPlaying', 'Now Playing')}
                  </span>
                  <span class="oda-card-meta">
                    {playStateLabel()}
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
                <span class="oda-card-label">{translate(card.labelKey, card.labelFallback)}</span>
                {#if card.id === 'queue'}
                  <span class="oda-card-meta">
                    {queueCount === 1
                      ? translate('oda.home.queueOne', '1 track')
                      : translate('oda.home.queueCount', '{count} tracks', { count: queueCount })}
                  </span>
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
