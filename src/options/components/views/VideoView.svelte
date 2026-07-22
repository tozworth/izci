<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '../SettingsField.svelte';
  import { VIDEO_VIEWPORT_AREA_OPTIONS, videoSettings } from '$lib/stores/video-settings';
  import type { VideoViewportArea } from '$lib/types';

  function handleAutoResizeWindowToggle(event: Event) {
    videoSettings.update({
      autoResizeWindow: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleViewportAreaChange(event: Event) {
    videoSettings.update({
      viewportArea: (event.currentTarget as HTMLSelectElement).value as VideoViewportArea
    });
  }

  function viewportAreaLabel(value: VideoViewportArea): string {
    if (value === 'left-center') {
      return $t('options.video.viewportArea.options.leftCenter', { default: 'Left and center' });
    }
    if (value === 'center-right') {
      return $t('options.video.viewportArea.options.centerRight', { default: 'Center and right' });
    }
    if (value === 'all') {
      return $t('options.video.viewportArea.options.all', { default: 'All panels' });
    }
    return $t('options.video.viewportArea.options.center', { default: 'Center panel' });
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
        title={$t('options.video.viewportArea.title', { default: 'Video viewport area' })}
        hint={$t('options.video.viewportArea.hint', { default: 'Chooses which open workspace panels the video covers.' })}
      >
        <select value={$videoSettings.viewportArea} on:change={handleViewportAreaChange}>
          {#each VIDEO_VIEWPORT_AREA_OPTIONS as option}
            <option value={option.value}>{viewportAreaLabel(option.value)}</option>
          {/each}
        </select>
      </SettingsField>
    </div>
  </div>
</article>
