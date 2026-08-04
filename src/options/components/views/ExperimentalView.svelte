<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import MultiplayerMark from '$lib/components/multiplayer/MultiplayerMark.svelte';
  import {
    MULTIPLAYER_MAX_LISTENERS_MAX,
    MULTIPLAYER_MAX_LISTENERS_MIN,
    MULTIPLAYER_OPUS_BITRATE_MAX_KBPS,
    MULTIPLAYER_OPUS_BITRATE_MIN_KBPS,
    MULTIPLAYER_OPUS_BITRATE_STEP_KBPS,
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

  function handleSendPostRafToggle(event: Event) {
    experimentalSettings.update({ multiplayerSendPostRaf: checked(event) });
  }

  function handleOpusBitrateChange(event: Event) {
    experimentalSettings.update({
      multiplayerOpusBitrateKbps: (event.currentTarget as HTMLInputElement).valueAsNumber
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
          type="text"
          maxlength="48"
          value={$experimentalSettings.izciName}
          on:change={handleIzciNameChange}
        />
      </SettingsField>
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
      <SettingsField
        title={$t('options.experimental.multiplayer.maxListeners.title', { default: 'Maximum listeners' })}
        hint={$t('options.experimental.multiplayer.maxListeners.hint', { default: 'Limits new listeners because the host encodes and sends one stream per peer.' })}
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
        {$t('options.experimental.multiplayer.diagnostics.direct', { default: 'izci asks Cloudflare and Google STUN servers for public ICE candidates, then tries direct routes. TURN relay is not configured, so restrictive NAT or firewall combinations can still prevent a connection.' })}
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
  </div>
</article>

<style>
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
