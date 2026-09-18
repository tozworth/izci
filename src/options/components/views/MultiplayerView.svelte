<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import MultiplayerMark from '$lib/components/multiplayer/MultiplayerMark.svelte';
  import SidekickSetupPanel from '$lib/components/multiplayer/SidekickSetupPanel.svelte';
  import {
    MULTIPLAYER_AUDIO_BUFFER_MAX_MS,
    MULTIPLAYER_AUDIO_BUFFER_MIN_MS,
    MULTIPLAYER_AUDIO_BUFFER_STEP_MS,
    MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB,
    MULTIPLAYER_MAX_LISTENERS_MAX,
    MULTIPLAYER_MAX_LISTENERS_MIN,
    MULTIPLAYER_OPUS_BITRATE_MAX_KBPS,
    MULTIPLAYER_OPUS_BITRATE_MIN_KBPS,
    MULTIPLAYER_OPUS_BITRATE_STEP_KBPS,
    MULTIPLAYER_RENDER_CACHE_LIMITS_MIB,
    MULTIPLAYER_SYNC_LEAD_TIME_MAX_MS,
    MULTIPLAYER_SYNC_LEAD_TIME_MIN_MS,
    MULTIPLAYER_SYNC_LEAD_TIME_STEP_MS,
    MULTIPLAYER_TURN_CREDENTIAL_HOURS_MAX,
    MULTIPLAYER_TURN_CREDENTIAL_HOURS_MIN,
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
      multiplayerTransport: value === 'sidekick' ? 'sidekick' : 'rtdb'
    });
  }

  function handleWaitForClientsToggle(event: Event) {
    multiplayerSettings.update({ multiplayerWaitForClients: checked(event) });
  }

  function handleSynchronizedPlaybackToggle(event: Event) {
    multiplayerSettings.update({ multiplayerSynchronizedPlayback: checked(event) });
  }

  function handleSyncLeadTimeChange(event: Event) {
    multiplayerSettings.update({
      multiplayerSyncLeadTimeMs: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }

  function handleRenderCacheLimitChange(event: Event) {
    multiplayerSettings.update({
      multiplayerRenderCacheLimitMiB: Number((event.currentTarget as HTMLSelectElement).value)
    });
  }

  function renderCacheLimitLabel(limit: number): string {
    if (limit === 0) return $t('options.multiplayer.renderCache.off', { default: 'Off' });
    return `${limit} MiB`;
  }

  function handleFileTransferLimitChange(event: Event) {
    const index = (event.currentTarget as HTMLInputElement).valueAsNumber;
    multiplayerSettings.update({
      multiplayerFileTransferLimitMiB: MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB[index] ?? 0
    });
  }

  function fileTransferLimitIndex(limit: number): number {
    const index = MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB.indexOf(
      limit as (typeof MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB)[number]
    );
    return index < 0 ? 0 : index;
  }

  function fileTransferLimitLabel(limit: number): string {
    if (limit < 0) return $t('options.multiplayer.fileTransfer.every', { default: 'Every file' });
    if (limit === 0) return $t('options.multiplayer.fileTransfer.never', { default: 'Buffered Opus only' });
    return `${limit} MiB`;
  }

  function handleTurnUrlChange(event: Event) {
    multiplayerSettings.update({
      multiplayerTurnUrl: (event.currentTarget as HTMLInputElement).value
    });
  }

  function handleTurnSecretChange(event: Event) {
    multiplayerSettings.update({
      multiplayerTurnSecret: (event.currentTarget as HTMLInputElement).value
    });
  }

  function handleTurnCredentialHoursChange(event: Event) {
    multiplayerSettings.update({
      multiplayerTurnCredentialHours: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }

  function handleForceTurnToggle(event: Event) {
    multiplayerSettings.update({ multiplayerForceTurn: checked(event) });
  }

  function handleOpusBitrateChange(event: Event) {
    multiplayerSettings.update({
      multiplayerOpusBitrateKbps: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }

  function handleAudioBufferChange(event: Event) {
    multiplayerSettings.update({
      multiplayerAudioBufferMs: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }

  function handleMaxListenersChange(event: Event) {
    multiplayerSettings.update({
      multiplayerMaxListeners: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }

  function handleAutoHostToggle(event: Event) {
    multiplayerSettings.update({ multiplayerAutoHost: checked(event) });
  }

  function handleRestoreSessionToggle(event: Event) {
    multiplayerSettings.update({ multiplayerRestoreLastSession: checked(event) });
  }

  $: multiplayerMode = deriveMultiplayerMode($multiplayerSettings);
  $: multiplayerEnabled = multiplayerMode !== 'singleplayer';
  $: multiplayerAudioEnabled = multiplayerMode === 'coopAudio' || multiplayerMode === 'freeplay';
  $: coopAudioEnabled = multiplayerMode === 'coopAudio';
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
            {$t('options.multiplayer.modes.freeplayBadge', { default: 'Highly experimental' })}
          </span>
        </span>
        <span class="multiplayer-mode-description">
          {$t('options.multiplayer.modes.freeplay.hint', { default: 'Paired clients can browse and play music from the host’s library independently, with their own queue, playback, and audio.' })}
        </span>
      </button>
    </div>
    <div class="field-grid">
      <SettingsField
        title={$t('options.multiplayer.transport.title', { default: 'Signaling transport' })}
        hint={$t('options.multiplayer.transport.hint', { default: 'Firebase is the legacy invite-code path. Sidekick uses a self-hosted server.' })}
      >
        <select value={$multiplayerSettings.multiplayerTransport} on:change={handleTransportChange}>
          <option value="rtdb">{$t('options.multiplayer.transport.rtdb', { default: 'Firebase (legacy invites)' })}</option>
          <option value="sidekick">{$t('options.multiplayer.transport.sidekick', { default: 'Sidekick server' })}</option>
        </select>
      </SettingsField>
      {#if $multiplayerSettings.multiplayerTransport === 'sidekick'}
        <div class="sidekick-config">
          <SidekickSetupPanel mode="config" />
        </div>
      {/if}
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
        title={$t('options.multiplayer.waitForClients.title', { default: 'Wait for clients' })}
        hint={$t('options.multiplayer.waitForClients.hint', { default: 'Before starting a track, waits until every connected listener has loaded its transferred file or tuned to the audio stream.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$multiplayerSettings.multiplayerWaitForClients}
          on:change={handleWaitForClientsToggle}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.autoHost.title', { default: 'Always host for peers' })}
        hint={$t('options.multiplayer.autoHost.hint', { default: 'Silently hosts on launch so paired devices can join without an invite code.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$multiplayerSettings.multiplayerAutoHost}
          disabled={!multiplayerEnabled}
          on:change={handleAutoHostToggle}
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
      {#if $multiplayerSettings.multiplayerTransport === 'rtdb'}
      <SettingsField
        title={$t('options.multiplayer.turnUrl.title', { default: 'TURN server' })}
        hint={$t('options.multiplayer.turnUrl.hint', { default: 'Host-only relay endpoint, such as relay.example.net:3478 or turns:relay.example.net:5349. Listeners receive it with temporary credentials.' })}
      >
        <input
          class="multiplayer-text-input multiplayer-endpoint-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="turn:host:3478"
          value={$multiplayerSettings.multiplayerTurnUrl}
          on:change={handleTurnUrlChange}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.turnSecret.title', { default: 'TURN authentication secret' })}
        hint={$t('options.multiplayer.turnSecret.hint', { default: 'Host-only shared secret configured on the relay. Listeners receive encrypted temporary credentials and do not need this setting.' })}
      >
        <input
          class="multiplayer-text-input"
          type="password"
          autocomplete="current-password"
          value={$multiplayerSettings.multiplayerTurnSecret}
          on:change={handleTurnSecretChange}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.turnLifetime.title', { default: 'TURN credential lifetime' })}
        hint={$t('options.multiplayer.turnLifetime.hint', { default: 'Sets the expiry of credentials minted for each listener. Longer values better tolerate long sessions and reconnects.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_TURN_CREDENTIAL_HOURS_MIN}
          max={MULTIPLAYER_TURN_CREDENTIAL_HOURS_MAX}
          step="1"
          value={$multiplayerSettings.multiplayerTurnCredentialHours}
          disabled={!$multiplayerSettings.multiplayerTurnUrl || !$multiplayerSettings.multiplayerTurnSecret}
          on:input={handleTurnCredentialHoursChange}
        />
        <span class="field-output">{$multiplayerSettings.multiplayerTurnCredentialHours} h</span>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.forceTurn.title', { default: 'Force TURN relay' })}
        hint={$t('options.multiplayer.forceTurn.hint', { default: 'Uses relay candidates only on the host and listeners. Enable temporarily to verify the relay or keep enabled when direct routes must never be used.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$multiplayerSettings.multiplayerForceTurn}
          disabled={!$multiplayerSettings.multiplayerTurnUrl || !$multiplayerSettings.multiplayerTurnSecret}
          on:change={handleForceTurnToggle}
        />
      </SettingsField>
      {/if}
      <SettingsField
        title={$t('options.multiplayer.maxListeners.title', { default: 'Maximum guests' })}
        hint={$t('options.multiplayer.maxListeners.hint', { default: 'Limits how many guests can connect to the host at once, whether or not audio streaming is enabled.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_MAX_LISTENERS_MIN}
          max={MULTIPLAYER_MAX_LISTENERS_MAX}
          step="1"
          value={$multiplayerSettings.multiplayerMaxListeners}
          on:input={handleMaxListenersChange}
        />
        <span class="field-output">{$multiplayerSettings.multiplayerMaxListeners}</span>
      </SettingsField>
    </div>
  </div>
  <div class="section">
    <h2>{$t('options.multiplayer.audioCategory', { default: 'Multiplayer Audio' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.multiplayer.synchronizedPlayback.title', { default: 'Synchronized playback' })}
        hint={$t('options.multiplayer.synchronizedPlayback.hint', { default: 'Coordinates a shared start time across the host and listeners. Works best with sent files; streamed audio remains best effort because browser buffers vary.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$multiplayerSettings.multiplayerSynchronizedPlayback}
          disabled={!coopAudioEnabled}
          on:change={handleSynchronizedPlaybackToggle}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.syncLeadTime.title', { default: 'Start lead time' })}
        hint={$t('options.multiplayer.syncLeadTime.hint', { default: 'How far ahead the host schedules a synchronized start after every listener is ready. Increase it when devices miss the opening beat.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_SYNC_LEAD_TIME_MIN_MS}
          max={MULTIPLAYER_SYNC_LEAD_TIME_MAX_MS}
          step={MULTIPLAYER_SYNC_LEAD_TIME_STEP_MS}
          value={$multiplayerSettings.multiplayerSyncLeadTimeMs}
          disabled={!coopAudioEnabled || !$multiplayerSettings.multiplayerSynchronizedPlayback}
          on:input={handleSyncLeadTimeChange}
        />
        <span class="field-output">{$multiplayerSettings.multiplayerSyncLeadTimeMs} ms</span>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.fileTransfer.title', { default: 'Send files under' })}
        hint={$t('options.multiplayer.fileTransfer.hint', { default: 'Sends smaller audio and module files whole, then plays them on each listener. Larger files are pre-rendered to buffered Opus by the host. Modules are usually small, so they transfer directly.' })}
      >
        <input
          type="range"
          min="0"
          max={MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB.length - 1}
          step="1"
          value={fileTransferLimitIndex($multiplayerSettings.multiplayerFileTransferLimitMiB)}
          disabled={!multiplayerAudioEnabled}
          on:input={handleFileTransferLimitChange}
        />
        <span class="field-output">{fileTransferLimitLabel($multiplayerSettings.multiplayerFileTransferLimitMiB)}</span>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.opusBitrate.title', { default: 'Opus VBR bitrate' })}
        hint={$t('options.multiplayer.opusBitrate.hint', { default: 'Controls the bitrate of the pre-rendered Opus stream each listener downloads. Higher rates use more host bandwidth and encoding work.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_OPUS_BITRATE_MIN_KBPS}
          max={MULTIPLAYER_OPUS_BITRATE_MAX_KBPS}
          step={MULTIPLAYER_OPUS_BITRATE_STEP_KBPS}
          value={$multiplayerSettings.multiplayerOpusBitrateKbps}
          disabled={!multiplayerAudioEnabled || $multiplayerSettings.multiplayerFileTransferLimitMiB < 0}
          on:input={handleOpusBitrateChange}
        />
        <span class="field-output">{$multiplayerSettings.multiplayerOpusBitrateKbps} kbps</span>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.audioBuffer.title', { default: 'Start/rebuffer after' })}
        hint={$t('options.multiplayer.audioBuffer.hint', { default: 'How much audio each listener buffers before playback starts and after a rebuffer. Download keeps running ahead while paused.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_AUDIO_BUFFER_MIN_MS}
          max={MULTIPLAYER_AUDIO_BUFFER_MAX_MS}
          step={MULTIPLAYER_AUDIO_BUFFER_STEP_MS}
          value={$multiplayerSettings.multiplayerAudioBufferMs}
          disabled={!multiplayerAudioEnabled}
          on:input={handleAudioBufferChange}
        />
        <span class="field-output">{$multiplayerSettings.multiplayerAudioBufferMs} ms</span>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.renderCache.title', { default: 'Pre-render memory limit' })}
        hint={$t('options.multiplayer.renderCache.hint', { default: 'How much host memory the compressed render cache may use. Active tracks stay pinned; older renders are evicted by least-recent use.' })}
      >
        <select
          value={$multiplayerSettings.multiplayerRenderCacheLimitMiB}
          disabled={!multiplayerAudioEnabled}
          on:change={handleRenderCacheLimitChange}
        >
          {#each MULTIPLAYER_RENDER_CACHE_LIMITS_MIB as limit}
            <option value={limit}>{renderCacheLimitLabel(limit)}</option>
          {/each}
        </select>
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
    {#if $multiplayerSettings.multiplayerTransport === 'sidekick'}
      <p>
        {$t('options.multiplayer.sidekick.noticeText', { default: 'The sidekick sees connection metadata and relays SDP and ICE while connecting; it is trusted for signaling.' })}
      </p>
    {:else}
      <p>
        {$t('options.multiplayer.diagnostics.signaling', { default: 'Firebase only exchanges the invite, session descriptions, and ICE candidates. Playback controls, catalog data, artwork, and audio use the resulting peer connection.' })}
      </p>
    {/if}
    <p>
      {#if $multiplayerSettings.multiplayerTransport === 'sidekick'}
        {$t('options.multiplayer.sidekick.iceManaged', { default: 'STUN and TURN are supplied by the Sidekick operator. This client does not configure relay credentials.' })}
      {:else}
        {$t('options.multiplayer.diagnostics.direct', { default: 'izci asks Cloudflare and Google STUN servers for public ICE candidates, then tries direct routes. When configured above, TURN adds a relay path for restrictive NAT or firewall combinations.' })}
      {/if}
    </p>
    <p>
      {$t('options.multiplayer.diagnostics.upnp', { default: 'A static public IP or router UPnP does not guarantee success: Chromium chooses its own ICE ports and izci does not request a UPnP port mapping.' })}
    </p>
    <p>
      {$t('options.multiplayer.diagnostics.messages', { default: 'Failure to gather candidates points to browser or network policy; local-only candidates point to STUN failure; candidates on both sides with no connection point to NAT or firewall filtering.' })}
    </p>
    <p>
      {$t('options.multiplayer.diagnostics.tailnet', { default: 'A successful Tailscale connection may use tailnet addresses, router port mapping, or DERP. It does not prove that the same devices have a usable direct route with Tailscale off.' })}
    </p>
  </aside>
</article>

<style>
  :global(html:not([data-izci-mobile='true'])) input.multiplayer-text-input {
    width: min(12rem, 32vw);
  }

  input.multiplayer-endpoint-input {
    font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
    font-size: 0.74rem;
  }

  .sidekick-config {
    grid-column: 1 / -1;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border-faint);
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--bg-input) 55%, transparent);
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
    border: 1px solid color-mix(in srgb, var(--danger) 42%, transparent);
    background: color-mix(in srgb, var(--danger) 9%, transparent);
    color: var(--danger);
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
