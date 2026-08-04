<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import MultiplayerMark from '$lib/components/multiplayer/MultiplayerMark.svelte';
  import {
    MULTIPLAYER_AUDIO_BUFFER_MAX_MS,
    MULTIPLAYER_AUDIO_BUFFER_MIN_MS,
    MULTIPLAYER_AUDIO_BUFFER_STEP_MS,
    MULTIPLAYER_MAX_LISTENERS_MAX,
    MULTIPLAYER_MAX_LISTENERS_MIN,
    MULTIPLAYER_OPUS_BITRATE_MAX_KBPS,
    MULTIPLAYER_OPUS_BITRATE_MIN_KBPS,
    MULTIPLAYER_OPUS_BITRATE_STEP_KBPS,
    MULTIPLAYER_TURN_CREDENTIAL_HOURS_MAX,
    MULTIPLAYER_TURN_CREDENTIAL_HOURS_MIN,
    experimentalSettings
  } from '$lib/stores/experimental-settings';

  function checked(event: Event): boolean {
    return (event.currentTarget as HTMLInputElement).checked;
  }

  function handleMultiplayerToggle(event: Event) {
    experimentalSettings.update({
      multiplayer: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleIzciNameChange(event: Event) {
    experimentalSettings.update({
      izciName: (event.currentTarget as HTMLInputElement).value
    });
  }

  function handleStreamAudioToggle(event: Event) {
    experimentalSettings.update({ multiplayerStreamAudio: checked(event) });
  }

  function handleTurnUrlChange(event: Event) {
    experimentalSettings.update({
      multiplayerTurnUrl: (event.currentTarget as HTMLInputElement).value
    });
  }

  function handleTurnSecretChange(event: Event) {
    experimentalSettings.update({
      multiplayerTurnSecret: (event.currentTarget as HTMLInputElement).value
    });
  }

  function handleTurnCredentialHoursChange(event: Event) {
    experimentalSettings.update({
      multiplayerTurnCredentialHours: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }

  function handleForceTurnToggle(event: Event) {
    experimentalSettings.update({ multiplayerForceTurn: checked(event) });
  }

  function handleSendPostRafToggle(event: Event) {
    experimentalSettings.update({ multiplayerSendPostRaf: checked(event) });
  }

  function handleOpusBitrateChange(event: Event) {
    experimentalSettings.update({
      multiplayerOpusBitrateKbps: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }

  function handleAudioBufferChange(event: Event) {
    experimentalSettings.update({
      multiplayerAudioBufferMs: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }

  function handleIncludeVideoAudioToggle(event: Event) {
    experimentalSettings.update({ multiplayerIncludeVideoAudio: checked(event) });
  }

  function handleMaxListenersChange(event: Event) {
    experimentalSettings.update({
      multiplayerMaxListeners: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.experimental.multiplayer.category', { default: 'Multiplayer' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.experimental.multiplayer.title', { default: 'izci Multiplayer' })}
        hint={$t('options.experimental.multiplayer.hint', { default: 'Lets this izci host or join a shared listening session. Firebase handles the handshake; audio travels directly between peers.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$experimentalSettings.multiplayer}
          on:change={handleMultiplayerToggle}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.name', { default: 'Name this izci' })}
        hint={$t('options.experimental.multiplayer.nameHint', { default: 'Shown to hosts and clients in multiplayer sessions.' })}
      >
        <input
          class="multiplayer-text-input"
          type="text"
          maxlength="48"
          value={$experimentalSettings.izciName}
          on:change={handleIzciNameChange}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.turnUrl.title', { default: 'TURN server' })}
        hint={$t('options.experimental.multiplayer.turnUrl.hint', { default: 'Host-only relay endpoint, such as relay.example.net:3478 or turns:relay.example.net:5349. Listeners receive it with temporary credentials.' })}
      >
        <input
          class="multiplayer-text-input multiplayer-endpoint-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="turn:host:3478"
          value={$experimentalSettings.multiplayerTurnUrl}
          on:change={handleTurnUrlChange}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.turnSecret.title', { default: 'TURN authentication secret' })}
        hint={$t('options.experimental.multiplayer.turnSecret.hint', { default: 'Host-only shared secret configured on the relay. Listeners receive encrypted temporary credentials and do not need this setting.' })}
      >
        <input
          class="multiplayer-text-input"
          type="password"
          autocomplete="current-password"
          value={$experimentalSettings.multiplayerTurnSecret}
          on:change={handleTurnSecretChange}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.turnLifetime.title', { default: 'TURN credential lifetime' })}
        hint={$t('options.experimental.multiplayer.turnLifetime.hint', { default: 'Sets the expiry of credentials minted for each listener. Longer values better tolerate long sessions and reconnects.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_TURN_CREDENTIAL_HOURS_MIN}
          max={MULTIPLAYER_TURN_CREDENTIAL_HOURS_MAX}
          step="1"
          value={$experimentalSettings.multiplayerTurnCredentialHours}
          disabled={!$experimentalSettings.multiplayerTurnUrl || !$experimentalSettings.multiplayerTurnSecret}
          on:input={handleTurnCredentialHoursChange}
        />
        <span class="field-output">{$experimentalSettings.multiplayerTurnCredentialHours} h</span>
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.forceTurn.title', { default: 'Force TURN relay' })}
        hint={$t('options.experimental.multiplayer.forceTurn.hint', { default: 'Uses relay candidates only on the host and listeners. Enable temporarily to verify the relay or keep enabled when direct routes must never be used.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$experimentalSettings.multiplayerForceTurn}
          disabled={!$experimentalSettings.multiplayerTurnUrl || !$experimentalSettings.multiplayerTurnSecret}
          on:change={handleForceTurnToggle}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.maxListeners.title', { default: 'Maximum guests' })}
        hint={$t('options.experimental.multiplayer.maxListeners.hint', { default: 'Limits how many guests can connect to the host at once, whether or not audio streaming is enabled.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_MAX_LISTENERS_MIN}
          max={MULTIPLAYER_MAX_LISTENERS_MAX}
          step="1"
          value={$experimentalSettings.multiplayerMaxListeners}
          on:input={handleMaxListenersChange}
        />
        <span class="field-output">{$experimentalSettings.multiplayerMaxListeners}</span>
      </SettingsField>
    </div>
  </div>
  <div class="section">
    <h2>{$t('options.experimental.multiplayer.audioCategory', { default: 'Multiplayer Audio' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.experimental.multiplayer.streamAudio.title', { default: 'Stream audio to listeners' })}
        hint={$t('options.experimental.multiplayer.streamAudio.hint', { default: 'Sends the host’s audio directly to connected peers. The host’s volume and mute do not affect listeners.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$experimentalSettings.multiplayerStreamAudio}
          on:change={handleStreamAudioToggle}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.postRaf.title', { default: 'Send post-Raf audio' })}
        hint={$t('options.experimental.multiplayer.postRaf.hint', { default: 'Applies the host’s Raf rack before streaming. When off, listeners receive pre-Raf audio and can apply their own Raf settings.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$experimentalSettings.multiplayerSendPostRaf}
          disabled={!$experimentalSettings.multiplayerStreamAudio}
          on:change={handleSendPostRafToggle}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.opusBitrate.title', { default: 'Opus VBR bitrate' })}
        hint={$t('options.experimental.multiplayer.opusBitrate.hint', { default: 'Sets the best-effort bitrate ceiling for each listener. Higher rates use more host bandwidth and encoding work.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_OPUS_BITRATE_MIN_KBPS}
          max={MULTIPLAYER_OPUS_BITRATE_MAX_KBPS}
          step={MULTIPLAYER_OPUS_BITRATE_STEP_KBPS}
          value={$experimentalSettings.multiplayerOpusBitrateKbps}
          disabled={!$experimentalSettings.multiplayerStreamAudio}
          on:input={handleOpusBitrateChange}
        />
        <span class="field-output">{$experimentalSettings.multiplayerOpusBitrateKbps} kbps</span>
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.audioBuffer.title', { default: 'Listener audio buffer' })}
        hint={$t('options.experimental.multiplayer.audioBuffer.hint', { default: 'Adds receiver delay to absorb network and mobile scheduling jitter. Increase it for cleaner playback; decrease it for faster control response.' })}
      >
        <input
          type="range"
          min={MULTIPLAYER_AUDIO_BUFFER_MIN_MS}
          max={MULTIPLAYER_AUDIO_BUFFER_MAX_MS}
          step={MULTIPLAYER_AUDIO_BUFFER_STEP_MS}
          value={$experimentalSettings.multiplayerAudioBufferMs}
          on:input={handleAudioBufferChange}
        />
        <span class="field-output">{$experimentalSettings.multiplayerAudioBufferMs} ms</span>
      </SettingsField>
      <SettingsField
        title={$t('options.experimental.multiplayer.videoAudio.title', { default: 'Include audio from videos' })}
        hint={$t('options.experimental.multiplayer.videoAudio.hint', { default: 'Keeps sending the soundtrack when the host plays a video; video pictures are never transmitted.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$experimentalSettings.multiplayerIncludeVideoAudio}
          disabled={!$experimentalSettings.multiplayerStreamAudio}
          on:change={handleIncludeVideoAudioToggle}
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
        {$t('options.experimental.multiplayer.diagnostics.heading', { default: 'Connection diagnostics' })}
      </h3>
    </div>
    <p>
      {$t('options.experimental.multiplayer.diagnostics.signaling', { default: 'Firebase only exchanges the invite, session descriptions, and ICE candidates. Playback controls, catalog data, artwork, and audio use the resulting peer connection.' })}
    </p>
    <p>
      {$t('options.experimental.multiplayer.diagnostics.direct', { default: 'izci asks Cloudflare and Google STUN servers for public ICE candidates, then tries direct routes. When configured above, TURN adds a relay path for restrictive NAT or firewall combinations.' })}
    </p>
    <p>
      {$t('options.experimental.multiplayer.diagnostics.upnp', { default: 'A static public IP or router UPnP does not guarantee success: Chromium chooses its own ICE ports and izci does not request a UPnP port mapping.' })}
    </p>
    <p>
      {$t('options.experimental.multiplayer.diagnostics.messages', { default: 'Failure to gather candidates points to browser or network policy; local-only candidates point to STUN failure; candidates on both sides with no connection point to NAT or firewall filtering.' })}
    </p>
    <p>
      {$t('options.experimental.multiplayer.diagnostics.tailnet', { default: 'A successful Tailscale connection may use tailnet addresses, router port mapping, or DERP. It does not prove that the same devices have a usable direct route with Tailscale off.' })}
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
