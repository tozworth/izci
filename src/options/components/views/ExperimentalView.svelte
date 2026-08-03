<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
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
    <h2>{$t('options.experimental.heading', { default: 'Experiments' })}</h2>
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
        hint={$t('options.experimental.multiplayer.streamAudio.hint', { default: 'Sends the host’s post-Raf audio directly to connected peers. The host’s volume and mute do not affect listeners.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$experimentalSettings.multiplayerStreamAudio}
          on:change={handleStreamAudioToggle}
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
  </div>
</article>
