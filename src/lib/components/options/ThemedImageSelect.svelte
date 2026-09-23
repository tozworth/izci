<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let src: string | null = null;
  export let label: string;
  export let chooseLabel: string;
  export let accept = 'image/*';

  const dispatch = createEventDispatcher<{ change: File }>();

  let fileInput: HTMLInputElement | null = null;

  /** Open the file picker programmatically (e.g. right after switching to Custom). */
  export function open() {
    fileInput?.click();
  }

  function handleFileChange() {
    const file = fileInput?.files?.[0] ?? null;
    if (fileInput) fileInput.value = '';
    if (file) dispatch('change', file);
  }
</script>

<button
  class="image-pill"
  class:empty={!src}
  type="button"
  aria-label={label}
  on:click={open}
>
  {#if src}
    <img src={src} alt="" aria-hidden="true" />
  {/if}
  <span class="pick">
    <span class="pick-label">{chooseLabel}</span>
    <span class="material-symbols-outlined pick-icon" aria-hidden="true">add_photo_alternate</span>
  </span>
  <input
    bind:this={fileInput}
    class="image-file-input"
    type="file"
    {accept}
    tabindex="-1"
    aria-hidden="true"
    on:change={handleFileChange}
  />
</button>

<style>
  .image-pill {
    position: relative;
    width: 100%;
    min-height: 28px;
    display: block;
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--menu-bar-border);
    border-radius: 999px;
    background: var(--bg-input);
    color: var(--text);
    cursor: pointer;
  }

  .image-pill img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .image-pill:focus-visible {
    outline: 1px solid var(--accent-strong);
    outline-offset: 1px;
  }

  .pick {
    position: absolute;
    top: 50%;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    transform: translateY(-50%);
  }

  .pick-label {
    max-width: 0;
    overflow: hidden;
    font-size: 0.72rem;
    opacity: 0;
    text-shadow: 0 0 6px rgba(0, 0, 0, 0.7);
    transition: max-width 0.16s ease, opacity 0.16s ease;
    white-space: nowrap;
  }

  .image-pill:hover .pick-label,
  .image-pill:focus-visible .pick-label {
    max-width: 12rem;
    opacity: 1;
  }

  .pick-icon {
    color: #fff;
    font-size: 17px;
    filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.65));
    transition: filter 0.16s ease;
  }

  .image-pill:hover .pick-icon,
  .image-pill:focus-visible .pick-icon {
    filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.85));
  }

  .image-file-input {
    display: none;
  }
</style>
