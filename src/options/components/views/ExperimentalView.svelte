<script lang="ts">
  import { experimentalSettings } from '$lib/stores/experimental-settings';

  function checked(event: Event) {
    return (event.currentTarget as HTMLInputElement).checked;
  }
</script>

<article class="view">
  <div class="section">
    <h2>Track Details</h2>
    <div class="field-grid">
      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Hide repeated album metadata</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$experimentalSettings.hideRedundantAlbumMetadata}
            on:change={(event) => experimentalSettings.update({ hideRedundantAlbumMetadata: checked(event) })}
          />
        </div>
        <p class="field-hint">
          Hides Album when it matches Title and Album Artist when it matches Artist in Track Details.
        </p>
      </label>
    </div>
  </div>

  <div class="section">
    <h2>Options</h2>
    <div class="field-grid">
      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Single-page mode</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$experimentalSettings.singlePageMode}
            on:change={(event) => experimentalSettings.update({ singlePageMode: checked(event) })}
          />
        </div>
        <p class="field-hint">
          Opens Options in the main window above the player bar instead of in a separate popup.
        </p>
      </label>
    </div>
  </div>

  <div class="section">
    <h2>Raf</h2>
    <div class="field-grid">
      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Effects list layout</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$experimentalSettings.rafEffectsList}
            on:change={(event) => experimentalSettings.update({ rafEffectsList: checked(event) })}
          />
        </div>
        <p class="field-hint">
          Moves effect management into a compact list beside a cardless editor. This layout is still being explored.
        </p>
      </label>
    </div>
  </div>
</article>
