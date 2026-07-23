<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '../SettingsField.svelte';
  import { videoSettings } from '$lib/stores/video-settings';

  function handleAutoResizeWindowToggle(event: Event) {
    videoSettings.update({
      autoResizeWindow: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleAutoEnterTheaterToggle(event: Event) {
    videoSettings.update({
      autoEnterTheater: (event.currentTarget as HTMLInputElement).checked
    });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.video.heading', { default: 'Video' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.video.autoResizeWindow.title', { default: 'Auto resize window' })}
        hint={$t('options.video.autoResizeWindow.hint', { default: 'Resizes an unsuitable player window to 1280 × 720 when video starts, then restores it when non-video playback begins.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$videoSettings.autoResizeWindow}
          on:change={handleAutoResizeWindowToggle}
        />
      </SettingsField>

      <SettingsField
        title={$t('options.video.autoEnterTheater.title', { default: 'Auto enter theater' })}
        hint={$t('options.video.autoEnterTheater.hint', { default: 'Opens video playback in theater automatically when a video starts.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$videoSettings.autoEnterTheater}
          on:change={handleAutoEnterTheaterToggle}
        />
      </SettingsField>
    </div>
  </div>
</article>
