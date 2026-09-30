<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import HoverTooltip from './HoverTooltip.svelte';
  import { t } from 'svelte-i18n';
  import type { MenuActionItem } from '$lib/types';
  import { PRESET_ICONS } from '$lib/utils/preset-icons';
  import { keepMenuInViewport } from '$lib/components/track-list-panel/actions/menu-viewport';

  export let picker: NonNullable<MenuActionItem['iconPicker']>;
  export let ariaLabel: string;
  export let nested = true;

  const dispatch = createEventDispatcher<{ action: string; dismiss: void }>();

  $: iconLabels = {
    music_note: $t('options.presetIcons.symbols.music_note', { default: 'Music note' }),
    music_video: $t('options.presetIcons.symbols.music_video', { default: 'Music video' }),
    album: $t('options.presetIcons.symbols.album', { default: 'Album' }),
    library_music: $t('options.presetIcons.symbols.library_music', { default: 'Music library' }),
    queue_music: $t('options.presetIcons.symbols.queue_music', { default: 'Music queue' }),
    playlist_play: $t('options.presetIcons.symbols.playlist_play', { default: 'Playlist' }),
    piano: $t('options.presetIcons.symbols.piano', { default: 'Piano' }),
    lyrics: $t('options.presetIcons.symbols.lyrics', { default: 'Lyrics' }),
    headphones: $t('options.presetIcons.symbols.headphones', { default: 'Headphones' }),
    speaker: $t('options.presetIcons.symbols.speaker', { default: 'Speaker' }),
    speaker_group: $t('options.presetIcons.symbols.speaker_group', { default: 'Speakers' }),
    radio: $t('options.presetIcons.symbols.radio', { default: 'Radio' }),
    mic: $t('options.presetIcons.symbols.mic', { default: 'Microphone' }),
    equalizer: $t('options.presetIcons.symbols.equalizer', { default: 'Equalizer' }),
    graphic_eq: $t('options.presetIcons.symbols.graphic_eq', { default: 'Audio spectrum' }),
    tune: $t('options.presetIcons.symbols.tune', { default: 'Sliders' }),
    volume_up: $t('options.presetIcons.symbols.volume_up', { default: 'Volume' }),
    spatial_audio: $t('options.presetIcons.symbols.spatial_audio', { default: 'Spatial audio' }),
    hearing: $t('options.presetIcons.symbols.hearing', { default: 'Ear' }),
    surround_sound: $t('options.presetIcons.symbols.surround_sound', { default: 'Surround sound' }),
    waves: $t('options.presetIcons.symbols.waves', { default: 'Waves' }),
    speed: $t('options.presetIcons.symbols.speed', { default: 'Speed' }),
    slow_motion_video: $t('options.presetIcons.symbols.slow_motion_video', { default: 'Slow motion' }),
    animation: $t('options.presetIcons.symbols.animation', { default: 'Animation' }),
    video_library: $t('options.presetIcons.symbols.video_library', { default: 'Video library' }),
    movie: $t('options.presetIcons.symbols.movie', { default: 'Movie' }),
    theaters: $t('options.presetIcons.symbols.theaters', { default: 'Film' }),
    tv: $t('options.presetIcons.symbols.tv', { default: 'Television' }),
    live_tv: $t('options.presetIcons.symbols.live_tv', { default: 'Live television' }),
    videocam: $t('options.presetIcons.symbols.videocam', { default: 'Video camera' }),
    image: $t('options.presetIcons.symbols.image', { default: 'Image' }),
    photo_library: $t('options.presetIcons.symbols.photo_library', { default: 'Photo library' }),
    favorite: $t('options.presetIcons.symbols.favorite', { default: 'Heart' }),
    star: $t('options.presetIcons.symbols.star', { default: 'Star' }),
    bookmark: $t('options.presetIcons.symbols.bookmark', { default: 'Bookmark' }),
    bolt: $t('options.presetIcons.symbols.bolt', { default: 'Lightning bolt' }),
    flare: $t('options.presetIcons.symbols.flare', { default: 'Sparkle' }),
    nightlight: $t('options.presetIcons.symbols.nightlight', { default: 'Moon' }),
    wb_sunny: $t('options.presetIcons.symbols.wb_sunny', { default: 'Sun' }),
    local_fire_department: $t('options.presetIcons.symbols.local_fire_department', { default: 'Flame' })
  };

  function select(icon: string) {
    dispatch('action', `${picker.actionPrefix}${icon}`);
    dispatch('dismiss');
  }

  function moveFocus(event: KeyboardEvent, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = Math.max(0, index - 1); break;
      case 'ArrowRight': next = Math.min(PRESET_ICONS.length - 1, index + 1); break;
      case 'ArrowUp': next = Math.max(0, index - 8); break;
      case 'ArrowDown': next = Math.min(PRESET_ICONS.length - 1, index + 8); break;
      case 'Home': next = 0; break;
      case 'End': next = PRESET_ICONS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    const grid = (event.currentTarget as HTMLButtonElement).parentElement;
    grid?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }
</script>

<div
  class="icon-menu-surface"
  class:icon-menu-surface-nested={nested}
  style:--preset-icon-color={picker.color ?? 'var(--accent-strong)'}
  use:keepMenuInViewport={nested}
  role="menu"
  aria-label={ariaLabel}
>
  <div class="icon-grid" role="none">
    {#each PRESET_ICONS as icon, index (icon)}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={picker.value === icon}
        aria-label={iconLabels[icon]}
        class:selected={picker.value === icon}
        on:keydown={(event) => moveFocus(event, index)}
        on:click={() => select(icon)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">{icon}</span>
        <HoverTooltip align="center" nowrap>{iconLabels[icon]}</HoverTooltip>
      </button>
    {/each}
  </div>
  <button
    type="button"
    class="default-icon"
    role="menuitemradio"
    aria-checked={!picker.value}
    on:click={() => select('default')}
  >
    <span class="material-symbols-outlined" aria-hidden="true">{picker.defaultIcon}</span>
    <span>{$t('options.presetIcons.defaultIcon', { default: 'Default icon' })}</span>
    {#if !picker.value}<span class="material-symbols-outlined default-check" aria-hidden="true">check</span>{/if}
  </button>
</div>

<style>
  .icon-menu-surface {
    width: max-content;
    padding: 0.35rem;
  }
  .icon-menu-surface-nested {
    position: absolute;
    top: -0.22rem;
    left: calc(100% + 0.2rem);
    z-index: 1;
    color: var(--menu-popover-text);
    background: var(--menu-popover-bg);
    border: 1px solid var(--menu-popover-border);
    border-radius: 0;
    box-shadow: var(--menu-popover-shadow);
  }
  .icon-grid {
    display: grid;
    grid-template-columns: repeat(8, 1.8rem);
    gap: 0.15rem;
  }
  .icon-menu-surface button {
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--preset-icon-color);
    cursor: default;
  }
  .icon-grid button {
    width: 1.8rem;
    height: 1.8rem;
    display: grid;
    place-items: center;
  }
  .icon-menu-surface button:hover,
  .icon-menu-surface button:focus-visible {
    background: var(--hover-surface);
    border-color: var(--menu-popover-text);
  }
  .icon-grid button.selected {
    border-color: var(--preset-icon-color);
    background: var(--hover-surface);
  }
  .icon-menu-surface .material-symbols-outlined { font-size: 1.15rem; }
  .icon-menu-surface button.default-icon {
    width: 100%;
    margin-top: 0.35rem;
    padding: 0.3rem;
    border-top-color: var(--menu-popover-border);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--menu-popover-text);
    text-align: left;
    font-size: inherit;
  }
  .default-icon > .material-symbols-outlined:first-child { color: var(--preset-icon-color); }
  .default-check { margin-left: auto; }
</style>
