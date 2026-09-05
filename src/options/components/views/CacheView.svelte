<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import {
    MULTIPLAYER_RENDER_DISK_CACHE_LIMITS_MIB,
    multiplayerSettings
  } from '$lib/stores/multiplayer-settings';
  import {
    multiplayerRenderDiskCache,
    type RenderCacheEntryInfo
  } from '$lib/services/multiplayer-render-disk-cache';

  let entries: RenderCacheEntryInfo[] = [];
  let totalBytes = 0;
  let loading = true;
  let busy = false;

  function checked(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked;
  }

  function handleEnableToggle(event: Event) {
    multiplayerSettings.update({ multiplayerRenderDiskCacheEnabled: checked(event) });
  }

  function handleLimitChange(event: Event) {
    multiplayerSettings.update({
      multiplayerRenderDiskCacheLimitMiB: Number((event.currentTarget as HTMLSelectElement).value)
    });
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB'];
    let value = bytes;
    let unit = -1;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
  }

  function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1_000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  async function refresh() {
    const listing = await multiplayerRenderDiskCache.list();
    entries = listing.entries;
    totalBytes = listing.totalBytes;
    loading = false;
  }

  async function removeEntry(entry: RenderCacheEntryInfo) {
    busy = true;
    try {
      await multiplayerRenderDiskCache.remove(entry.key);
      await refresh();
    } finally {
      busy = false;
    }
  }

  async function clearAll() {
    busy = true;
    try {
      await multiplayerRenderDiskCache.clear();
      await refresh();
    } finally {
      busy = false;
    }
  }

  $: settingsFingerprint =
    `${$multiplayerSettings.multiplayerRenderDiskCacheEnabled}:${$multiplayerSettings.multiplayerRenderDiskCacheLimitMiB}`;
  $: if (settingsFingerprint) void refresh();
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.cache.settingsCategory', { default: 'Client render cache' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.cache.enable.title', { default: 'Keep renders between sessions' })}
        hint={$t('options.cache.enable.hint', { default: 'Saves buffered Opus renders to a separate IndexedDB cache so rejoining or replaying a track skips the re-download. Entries are validated against the host manifest and are rebuilt on demand, never part of your library.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$multiplayerSettings.multiplayerRenderDiskCacheEnabled}
          on:change={handleEnableToggle}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.cache.limit.title', { default: 'Size limit' })}
        hint={$t('options.cache.limit.hint', { default: 'How much disk space the client render cache may use. The least-recently-heard renders are evicted first.' })}
      >
        <select
          value={$multiplayerSettings.multiplayerRenderDiskCacheLimitMiB}
          disabled={!$multiplayerSettings.multiplayerRenderDiskCacheEnabled}
          on:change={handleLimitChange}
        >
          {#each MULTIPLAYER_RENDER_DISK_CACHE_LIMITS_MIB as limit}
            <option value={limit}>{limit} MiB</option>
          {/each}
        </select>
      </SettingsField>
    </div>
  </div>
  <div class="section">
    <h2>{$t('options.cache.tracks.heading', { default: 'Cached renders' })}</h2>
    <p class="cache-usage">
      {#if loading}
        {$t('options.cache.tracks.loading', { default: 'Reading cache…' })}
      {:else}
        {$t('options.cache.tracks.usage', {
          default: '{used} of {limit} used · {count} renders',
          values: {
            used: formatBytes(totalBytes),
            limit: formatBytes($multiplayerSettings.multiplayerRenderDiskCacheLimitMiB * 1024 * 1024),
            count: entries.length
          }
        })}
      {/if}
    </p>
    {#if !loading && entries.length === 0}
      <p class="cache-empty">
        {$t('options.cache.tracks.empty', { default: 'No cached renders yet. Listen to a multiplayer session and renders will appear here.' })}
      </p>
    {:else if !loading}
      <ul class="cache-list">
        {#each entries as entry}
          <li class="cache-row">
            <span class="cache-row-name" title={entry.key}>{entry.name}</span>
            <span class="cache-row-meta">
              {entry.bitrateKbps} kbps · {formatDuration(entry.durationMs)} · {formatBytes(entry.sizeBytes)}
            </span>
            <span class="cache-row-stored">{new Date(entry.storedAt).toLocaleString()}</span>
            <button
              class="cache-button compact"
              type="button"
              disabled={busy}
              aria-label={$t('options.cache.tracks.remove', { default: 'Remove cached render' })}
              on:click={() => void removeEntry(entry)}
            >
              {$t('options.cache.tracks.removeLabel', { default: 'Remove' })}
            </button>
          </li>
        {/each}
      </ul>
      <div class="cache-actions">
        <button class="cache-button" type="button" disabled={busy} on:click={() => void refresh()}>
          {$t('options.cache.tracks.refresh', { default: 'Refresh' })}
        </button>
        <button
          class="cache-button"
          type="button"
          disabled={busy || entries.length === 0}
          on:click={() => void clearAll()}
        >
          {$t('options.cache.tracks.clearAll', { default: 'Clear all' })}
        </button>
      </div>
    {/if}
  </div>
</article>

<style>
  .cache-usage {
    margin: 0 0 0.6rem;
    color: var(--text-dim);
    font-size: 0.78rem;
  }

  .cache-empty {
    color: var(--text-dim);
    font-size: 0.8rem;
  }

  .cache-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .cache-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--bg-input) 62%, transparent);
  }

  .cache-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.82rem;
  }

  .cache-row-meta,
  .cache-row-stored {
    color: var(--text-dim);
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .cache-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 0.6rem;
  }

  .cache-button {
    min-height: 29px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
  }

  .cache-button:hover:not(:disabled) {
    background: var(--hover-surface);
    color: var(--text-strong);
  }

  .cache-button.compact {
    min-height: 24px;
    padding: 2px 8px;
    font-size: 0.74rem;
  }

  .cache-button:disabled {
    opacity: 0.5;
  }
</style>
