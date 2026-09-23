<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import ServerSetupPanel from '$lib/components/multiplayer/ServerSetupPanel.svelte';
  import {
    MULTIPLAYER_AUDIO_BUFFER_MAX_MS,
    MULTIPLAYER_AUDIO_BUFFER_MIN_MS,
    MULTIPLAYER_AUDIO_BUFFER_STEP_MS,
    MULTIPLAYER_CHAT_HISTORY_LINES,
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
    multiplayerSettings
  } from '$lib/stores/multiplayer-settings';

  function checked(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked;
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

  function handleMotdChange(event: Event): void {
    multiplayerSettings.update({
      multiplayerMotd: (event.currentTarget as HTMLInputElement).value
    });
  }

  function handleHistoryChange(event: Event): void {
    multiplayerSettings.update({
      multiplayerChatHistoryLines: MULTIPLAYER_CHAT_HISTORY_LINES[Number((event.currentTarget as HTMLInputElement).value)]
    });
  }

  $: chatHistoryIndex = MULTIPLAYER_CHAT_HISTORY_LINES.indexOf(
    $multiplayerSettings.multiplayerChatHistoryLines as (typeof MULTIPLAYER_CHAT_HISTORY_LINES)[number]
  );
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.multiplayer.hosting.category', { default: 'Hosting' })}</h2>
    <div class="field-grid">
      {#if $multiplayerSettings.multiplayerTransport === 'server'}
        <div class="server-config">
          <ServerSetupPanel mode="config" />
        </div>
      {/if}
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
          on:change={handleAutoHostToggle}
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
          disabled={!$multiplayerSettings.multiplayerSynchronizedPlayback}
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
          disabled={$multiplayerSettings.multiplayerFileTransferLimitMiB < 0}
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
          on:change={handleRenderCacheLimitChange}
        >
          {#each MULTIPLAYER_RENDER_CACHE_LIMITS_MIB as limit}
            <option value={limit}>{renderCacheLimitLabel(limit)}</option>
          {/each}
        </select>
      </SettingsField>
    </div>
  </div>
  <div class="section">
    <h2>{$t('options.multiplayer.chat.category', { default: 'Chat' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.multiplayer.chat.motd.title', { default: 'Message of the day' })}
        hint={$t('options.multiplayer.chat.motd.hint', { default: 'Shown above the chat to guests in sessions hosted by this izci.' })}
      >
        <input
          class="multiplayer-motd-input"
          type="text"
          maxlength="500"
          value={$multiplayerSettings.multiplayerMotd}
          on:change={handleMotdChange}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.chat.history.title', { default: 'Preserve chat history' })}
        hint={$t('options.multiplayer.chat.history.hint', { default: 'Keeps the latest chat lines on this device and restores them when it hosts again.' })}
      >
        <label class="chat-history-control">
          <input
            type="range"
            min="0"
            max={MULTIPLAYER_CHAT_HISTORY_LINES.length - 1}
            step="1"
            value={chatHistoryIndex}
            aria-label={$t('options.multiplayer.chat.history.title', { default: 'Preserve chat history' })}
            on:input={handleHistoryChange}
          />
          <output>{#if $multiplayerSettings.multiplayerChatHistoryLines === 0}{$t('options.multiplayer.chat.history.disabled', { default: 'Disabled' })}{:else}{$t('options.multiplayer.chat.history.lines', { default: '{count} lines', values: { count: $multiplayerSettings.multiplayerChatHistoryLines } })}{/if}</output>
        </label>
      </SettingsField>
    </div>
  </div>
</article>

<style>
  :global(html:not([data-izci-mobile='true'])) input.multiplayer-text-input {
    width: min(12rem, 32vw);
  }

  :global(html:not([data-izci-mobile='true'])) input.multiplayer-motd-input {
    width: min(24rem, 50vw);
  }

  input.multiplayer-endpoint-input {
    font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
    font-size: 0.74rem;
  }

  .server-config {
    grid-column: 1 / -1;
  }

  .chat-history-control { display: flex; align-items: center; gap: .6rem; }
  .chat-history-control input { width: min(14rem, 35vw); }
  .chat-history-control output { min-width: 5.5rem; }
</style>
