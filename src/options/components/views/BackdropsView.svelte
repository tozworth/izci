<script lang="ts">
  import {
    BACKDROP_EFFECT_OPTIONS, BACKDROP_ZONE_IDS, BACKDROP_ZONE_LABELS,
    MAX_BACKDROP_ARTWORK_BLUR, MAX_BACKDROP_ARTWORK_BRIGHTNESS,
    MIN_BACKDROP_ARTWORK_BLUR, MIN_BACKDROP_ARTWORK_BRIGHTNESS,
    appearanceSettings, hasArtworkBackdrop,
    normalizeBackdropZoneArtworkBlur, normalizeBackdropZoneArtworkBrightness
  } from '$lib/stores/appearance-settings';
  import type { BackdropZoneEffect, BackdropZoneId } from '$lib/types';

  function handleBackdropZoneChange(event: Event, zone: BackdropZoneId) {
    appearanceSettings.update({ backdropZones: { ...appearanceSettings.getSnapshot().backdropZones, [zone]: (event.currentTarget as HTMLSelectElement).value as BackdropZoneEffect } });
  }
  function updateArtwork(zone: BackdropZoneId, key: 'blur' | 'brightness', value: number) {
    const settings = appearanceSettings.getSnapshot();
    appearanceSettings.update({ backdropZoneArtwork: { ...settings.backdropZoneArtwork, [zone]: { ...settings.backdropZoneArtwork[zone], [key]: value } } });
  }
  function handleBackdropArtworkBlurChange(event: Event, zone: BackdropZoneId) {
    updateArtwork(zone, 'blur', normalizeBackdropZoneArtworkBlur((event.currentTarget as HTMLInputElement).valueAsNumber));
  }
  function handleBackdropArtworkBrightnessChange(event: Event, zone: BackdropZoneId) {
    updateArtwork(zone, 'brightness', normalizeBackdropZoneArtworkBrightness((event.currentTarget as HTMLInputElement).valueAsNumber));
  }
</script>

<article class="view">
  <div class="section">
    <h2>Backdrop Zones</h2>
    <div class="field-grid">
      {#each BACKDROP_ZONE_IDS as zone}
        <div class="field backdrop-zone-field">
          <label class="backdrop-zone-effect-row">
            <div class="field-copy">
              <span class="field-title">{BACKDROP_ZONE_LABELS[zone]}</span>
            </div>
            <div class="field-control">
              <select
                value={$appearanceSettings.backdropZones[zone]}
                on:change={(event) => handleBackdropZoneChange(event, zone)}
              >
                {#each BACKDROP_EFFECT_OPTIONS as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </div>
          </label>

          {#if hasArtworkBackdrop($appearanceSettings.backdropZones[zone])}
            <label class="backdrop-zone-slider">
              <span class="backdrop-zone-slider-label">Artwork blur strength</span>
              <div class="field-control">
                <input
                  type="range"
                  min={MIN_BACKDROP_ARTWORK_BLUR}
                  max={MAX_BACKDROP_ARTWORK_BLUR}
                  step="1"
                  value={$appearanceSettings.backdropZoneArtwork[zone].blur}
                  on:input={(event) => handleBackdropArtworkBlurChange(event, zone)}
                />
                <span class="field-output">{$appearanceSettings.backdropZoneArtwork[zone].blur}px</span>
              </div>
            </label>

            <label class="backdrop-zone-slider">
              <span class="backdrop-zone-slider-label">Artwork brightness</span>
              <div class="field-control">
                <input
                  type="range"
                  min={MIN_BACKDROP_ARTWORK_BRIGHTNESS}
                  max={MAX_BACKDROP_ARTWORK_BRIGHTNESS}
                  step="1"
                  value={$appearanceSettings.backdropZoneArtwork[zone].brightness}
                  aria-valuetext={`${$appearanceSettings.backdropZoneArtwork[zone].brightness}%`}
                  on:input={(event) => handleBackdropArtworkBrightnessChange(event, zone)}
                />
                <span class="field-output">{$appearanceSettings.backdropZoneArtwork[zone].brightness}%</span>
              </div>
            </label>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</article>

