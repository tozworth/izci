<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import MultiplayerMark from '$lib/components/multiplayer/MultiplayerMark.svelte';
  import {
    deriveMultiplayerMode,
    multiplayerSettings,
    multiplayerModePatch,
    type MultiplayerMode
  } from '$lib/stores/multiplayer-settings';

  function checked(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked;
  }

  function selectMode(mode: MultiplayerMode) {
    multiplayerSettings.update(multiplayerModePatch(mode));
  }

  function handleIzciNameChange(event: Event) {
    multiplayerSettings.update({
      izciName: (event.currentTarget as HTMLInputElement).value
    });
  }

  function handleTransportChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    multiplayerSettings.update({
      multiplayerTransport: value === 'server' ? 'server' : 'rtdb'
    });
  }

  function handleRestoreSessionToggle(event: Event) {
    multiplayerSettings.update({ multiplayerRestoreLastSession: checked(event) });
  }

  $: multiplayerMode = deriveMultiplayerMode($multiplayerSettings);
  $: multiplayerEnabled = multiplayerMode !== 'singleplayer';
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.multiplayer.category', { default: 'Multiplayer' })}</h2>
    <div
      class="multiplayer-mode-cards"
      role="group"
      aria-label={$t('options.multiplayer.modes.label', { default: 'Multiplayer mode' })}
    >
      <button
        type="button"
        class="multiplayer-mode-card"
        class:selected={multiplayerMode === 'singleplayer'}
        aria-pressed={multiplayerMode === 'singleplayer'}
        on:click={() => selectMode('singleplayer')}
      >
        <span class="multiplayer-mode-card-head">
          <span class="material-symbols-outlined multiplayer-mode-icon" aria-hidden="true">person</span>
          <span class="multiplayer-mode-title">
            {$t('options.multiplayer.modes.singleplayer.title', { default: 'Singleplayer' })}
          </span>
        </span>
        <span class="multiplayer-mode-description">
          {$t('options.multiplayer.modes.singleplayer.hint', { default: 'izci Multiplayer is turned off.' })}
        </span>
      </button>
      <button
        type="button"
        class="multiplayer-mode-card"
        class:selected={multiplayerMode === 'coop'}
        aria-pressed={multiplayerMode === 'coop'}
        on:click={() => selectMode('coop')}
      >
        <span class="multiplayer-mode-card-head">
          <span class="material-symbols-outlined multiplayer-mode-icon" aria-hidden="true">group</span>
          <span class="multiplayer-mode-title">
            {$t('options.multiplayer.modes.coop.title', { default: 'Co-op' })}
          </span>
        </span>
        <span class="multiplayer-mode-description">
          {$t('options.multiplayer.modes.coop.hint', { default: 'Clients can control the host’s queue and playback. Good for HTPCs, parties.' })}
        </span>
      </button>
      <button
        type="button"
        class="multiplayer-mode-card"
        class:selected={multiplayerMode === 'coopAudio'}
        aria-pressed={multiplayerMode === 'coopAudio'}
        on:click={() => selectMode('coopAudio')}
      >
        <span class="multiplayer-mode-card-head">
          <span class="material-symbols-outlined multiplayer-mode-icon" aria-hidden="true">headphones</span>
          <span class="multiplayer-mode-title">
            {$t('options.multiplayer.modes.coopAudio.title', { default: 'Co-op + audio' })}
          </span>
        </span>
        <span class="multiplayer-mode-description">
          {$t('options.multiplayer.modes.coopAudio.hint', { default: 'Clients can control the host and listen to its audio stream on their own device.' })}
        </span>
      </button>
      <button
        type="button"
        class="multiplayer-mode-card"
        class:selected={multiplayerMode === 'freeplay'}
        aria-pressed={multiplayerMode === 'freeplay'}
        on:click={() => selectMode('freeplay')}
      >
        <span class="multiplayer-mode-card-head">
          <span class="material-symbols-outlined multiplayer-mode-icon" aria-hidden="true">explore</span>
          <span class="multiplayer-mode-title">
            {$t('options.multiplayer.modes.freeplay.title', { default: 'Freeplay' })}
          </span>
          <span class="multiplayer-mode-badge">
            {$t('options.multiplayer.modes.freeplayBadge', { default: 'Experimental' })}
          </span>
        </span>
        <span class="multiplayer-mode-description">
          {$t('options.multiplayer.modes.freeplay.hint', { default: 'Clients can browse and play music from the host’s library independently, with their own queue, playback, and audio.' })}
        </span>
      </button>
    </div>
    <div class="field-grid">
      <SettingsField
        title={$t('options.multiplayer.transport.title', { default: 'Connection method' })}
        hint={$multiplayerSettings.multiplayerTransport === 'server'
          ? `${$t('options.multiplayer.transport.hint', { default: 'Firebase is the legacy invite-code path. Server uses a self-hosted server.' })} ${$t('options.multiplayer.hostingHint', { default: 'Server connection details live under Hosting.' })}`
          : $t('options.multiplayer.transport.hint', { default: 'Firebase is the legacy invite-code path. Server uses a self-hosted server.' })}
      >
        <select value={$multiplayerSettings.multiplayerTransport} on:change={handleTransportChange}>
          <option value="rtdb">{$t('options.multiplayer.transport.rtdb', { default: 'Firebase (legacy invites)' })}</option>
          <option value="server">{$t('options.multiplayer.transport.server', { default: 'Server server' })}</option>
        </select>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.name', { default: 'Name this izci' })}
        hint={$t('options.multiplayer.nameHint', { default: 'Shown to hosts and clients in multiplayer sessions.' })}
      >
        <input
          class="multiplayer-text-input"
          type="text"
          maxlength="48"
          value={$multiplayerSettings.izciName}
          on:change={handleIzciNameChange}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.restoreSession.title', { default: 'Restore last session' })}
        hint={$t('options.multiplayer.restoreSession.hint', { default: 'Reconnects to the previous host or resumes hosting after relaunch.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$multiplayerSettings.multiplayerRestoreLastSession}
          disabled={!multiplayerEnabled}
          on:change={handleRestoreSessionToggle}
        />
      </SettingsField>
    </div>
  </div>
  <aside class="multiplayer-footnotes" aria-labelledby="multiplayer-diagnostics-heading">
    <div class="multiplayer-diagnostics-header">
      <MultiplayerMark
        size="0.7rem"
        label={$t('main.multiplayer.markLabel', { default: 'izci multiplayer' })}
      />
      <h3 id="multiplayer-diagnostics-heading">
        {$t('options.multiplayer.diagnostics.heading', { default: 'Connection diagnostics' })}
      </h3>
    </div>
    {#if $multiplayerSettings.multiplayerTransport === 'server'}
      <p>
        {$t('options.multiplayer.server.noticeText', { default: 'The server sees connection metadata and relays SDP and ICE while connecting; it is trusted for signaling.' })}
      </p>
    {:else}
      <p>
        {$t('options.multiplayer.diagnostics.signaling', { default: 'Firebase only exchanges the invite, session descriptions, and ICE candidates. Playback controls, catalog data, artwork, and audio use the resulting peer connection.' })}
      </p>
    {/if}
    <p>
      {#if $multiplayerSettings.multiplayerTransport === 'server'}
        {$t('options.multiplayer.server.iceManaged', { default: 'STUN and TURN are supplied by the izci-server operator. This client does not configure relay credentials.' })}
      {:else}
        {$t('options.multiplayer.diagnostics.direct', { default: 'izci asks Cloudflare and Google STUN servers for public candidates, then tries direct routes. A TURN relay configured under Hosting adds a fallback path for restrictive NAT or firewalls.' })}
      {/if}
    </p>
    <p>
      {$t('options.multiplayer.diagnostics.upnp', { default: 'A static public IP or router UPnP is no guarantee: Chromium picks its own ICE ports and izci never requests a UPnP mapping.' })}
    </p>
    <p>
      {$t('options.multiplayer.diagnostics.messages', { default: 'No candidates at all points to browser or network policy; local-only candidates point to STUN failure; candidates on both sides with no connection point to NAT or firewall filtering.' })}
    </p>
  </aside>
</article>

<style>
  :global(html:not([data-izci-mobile='true'])) input.multiplayer-text-input {
    width: min(12rem, 32vw);
  }

  .multiplayer-mode-cards {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-bottom: 0.75rem;
  }

  .multiplayer-mode-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--bg-input) 62%, transparent);
    color: inherit;
    text-align: left;
  }

  .multiplayer-mode-card:hover {
    border-color: var(--border);
    background: var(--hover-subtle);
  }

  .multiplayer-mode-card.selected {
    border-color: var(--accent-strong-border-hover);
    background: var(--accent-strong-faint);
    box-shadow: inset 0 0 0 1px var(--accent-strong-border-hover);
  }

  .multiplayer-mode-card:focus-visible {
    outline: 2px solid var(--accent-focus-border);
    outline-offset: 1px;
  }

  .multiplayer-mode-card-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .multiplayer-mode-icon {
    flex: 0 0 auto;
    font-size: 1.05rem;
    color: var(--muted);
  }

  .multiplayer-mode-card.selected .multiplayer-mode-icon {
    color: var(--accent-strong);
  }

  .multiplayer-mode-title {
    min-width: 0;
    color: var(--text-strong);
    font-size: 0.78rem;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .multiplayer-mode-card.selected .multiplayer-mode-title {
    color: var(--accent-strong);
  }

  .multiplayer-mode-badge {
    flex: 0 0 auto;
    margin-left: auto;
    padding: 0.1rem 0.42rem;
    border: 1px solid color-mix(in srgb, #e08a1e 48%, transparent);
    background: color-mix(in srgb, #e08a1e 12%, transparent);
    color: #e08a1e;
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .multiplayer-mode-description {
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 1.42;
  }

  .multiplayer-footnotes {
    margin-top: 0.75rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--border-faint);
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--bg-input) 72%, transparent);
    color: var(--muted);
  }

  .multiplayer-footnotes h3 {
    margin: 0;
    color: var(--muted-strong);
    font-size: 0.74rem;
  }

  .multiplayer-diagnostics-header {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin-bottom: 0.45rem;
  }

  .multiplayer-footnotes p {
    margin: 0.3rem 0 0;
    font-size: 0.7rem;
    line-height: 1.42;
  }
</style>
