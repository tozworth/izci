<script lang="ts">
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { version as appVersion } from '../../../../package.json';
  import {
    applyAvailableServiceWorkerUpdate,
    forceServiceWorkerUpdateCheck,
    pwaUpdateCheckState
  } from '$lib/services/pwa-updates';
  import { formatDisplayVersion } from '$lib/utils/version';
  import { buildOptionsWindowPath } from '../../views';

  export let onOpenLicenses: () => void;

  const displayVersion = formatDisplayVersion(appVersion);

  $: successfulCheckFormatter = new Intl.DateTimeFormat($locale || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  $: updateStatusLabel = $pwaUpdateCheckState.status === 'checking'
    ? $t('options.about.updates.checking', { default: 'Checking for updates' })
    : $pwaUpdateCheckState.status === 'available'
      ? $t('options.about.updates.available', { default: 'Update available' })
      : $pwaUpdateCheckState.status === 'up-to-date'
        ? $t('options.about.updates.upToDate', { default: 'Up to date' })
        : $pwaUpdateCheckState.status === 'failed'
          ? $t('options.about.updates.failed', { default: 'Failed to check updates' })
          : $t('options.about.updates.checking', { default: 'Checking for updates' });

  $: lastSuccessfulCheck = $pwaUpdateCheckState.lastSuccessfulCheck === null
    ? $t('options.about.updates.noSuccessfulChecks', { default: 'No successful checks yet' })
    : $t('options.about.updates.lastChecked', { default: 'Last checked {date}', values: { date: successfulCheckFormatter.format($pwaUpdateCheckState.lastSuccessfulCheck) } });

  onMount(() => {
    void forceServiceWorkerUpdateCheck();
  });
</script>

<article class="view">
  <div class="section about-section">
    <div class="about-card">
      <div class="about-hero">
      <div class="about-pattern" aria-hidden="true">
        <div class="about-pattern-fragment fragment-a">
          <span>00 C-3 01 428</span><span>01 ... .. ...</span><span>02 G-3 02 A06</span><span>03 ... .. ...</span>
        </div>
        <div class="about-pattern-fragment fragment-b">
          <span>1C D#4 03 840</span><span>1D ... .. F03</span><span>1E A-3 01 20F</span><span>1F === == ===</span>
        </div>
        <div class="about-pattern-fragment fragment-c">
          <span>38 C-5 04 C20</span><span>39 ... .. 401</span><span>3A F-4 02 037</span>
        </div>
      </div>
        <div class="about-brand-lockup">
          <img class="about-logo" src="/icons/izci-mark-light.svg" alt={$t('options.about.logoAlt', { default: 'izci logo' })} />
          <div class="about-copy">
            <p class="about-kicker">{$t('options.about.kicker', { default: "GOLDILOCKED / SLOPTIMIZED / WCO'D" })}</p>
            <h3 class="about-name">izci</h3>
            <p class="about-tagline">{$t('options.about.tagline', { default: 'PWA music player' })}</p>
            <div class="about-meta-row">
              <span class="about-version">v{displayVersion}</span>
              <span>Toz · 2026</span>
            </div>
          </div>
        </div>
      </div>

      <div class="about-extension">
        <div
          class="about-update-status"
          class:update-checking={$pwaUpdateCheckState.status === 'checking'}
          class:update-available={$pwaUpdateCheckState.status === 'available'}
          class:update-failed={$pwaUpdateCheckState.status === 'failed'}
          aria-live="polite"
        >
          <span class="about-update-indicator" aria-hidden="true"></span>
          <span class="about-update-copy">
            <strong>{updateStatusLabel}</strong>
            {#if $pwaUpdateCheckState.status === 'available'}
              <button type="button" on:click={() => void applyAvailableServiceWorkerUpdate()}>
                {$t('options.about.updates.apply', { default: 'Click to update and restart' })}
              </button>
            {:else}
              <span>{lastSuccessfulCheck}</span>
            {/if}
          </span>
          {#if $pwaUpdateCheckState.status === 'up-to-date' || $pwaUpdateCheckState.status === 'failed'}
            <button
              class="about-update-refresh"
              type="button"
              aria-label={$t('options.about.updates.checkAgain', { default: 'Check for updates again' })}
              title={$t('options.about.updates.checkAgain', { default: 'Check for updates again' })}
              on:click={() => void forceServiceWorkerUpdateCheck()}
            >
              <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
            </button>
          {/if}
        </div>

        <a
          class="about-github-badge"
          href="https://github.com/dunsparce9/izci"
          target="_blank"
          rel="noreferrer"
          aria-label={$t('options.about.openOnGitHub', { default: 'Open dunsparce9/izci on GitHub' })}
        >
          <svg class="about-github-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 .7a11.6 11.6 0 0 0-3.7 22.6c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.6 11.6 0 0 0 12 .7Z" />
          </svg>
          <span>dunsparce9/izci</span>
        </a>
      </div>
    </div>
  </div>

  <div class="section">
    <ul class="feature-list">
      <li>
        <span class="material-symbols-outlined feature-icon" aria-hidden="true">music_note</span>
        <span>{$t('options.about.features.formats', { default: 'Plays usual streamed formats and tracker modules' })}<small class="feature-note">{$t('options.about.features.formatsNote', { default: 'It plays tracker modules!!!' })}</small></span>
      </li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">auto_stories</span><span>{$t('options.about.features.library', { default: 'A decent library with artwork, lyrics, and play counts' })}</span></li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">tab_group</span><span>{$t('options.about.features.workspace', { default: 'Dockable tabbed workspace, a big moody Now Playing view, and a mini player' })}</span></li>
      <li>
        <span class="material-symbols-outlined feature-icon" aria-hidden="true">desktop_windows</span>
        <span>{$t('options.about.features.pwa', { default: 'PWA niceties: file associations, media keys, custom window border' })}<small class="feature-note">{$t('options.about.features.pwaNote', { default: 'Only if your browser respects them (works on my machine)' })}</small></span>
      </li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">palette</span><span>{$t('options.about.features.backdrops', { default: 'Per-zone artwork and visualizer backdrops' })}</span></li>
      <li><span class="material-symbols-outlined feature-icon" aria-hidden="true">tune</span><span>{$t('options.about.features.raf', { default: 'Raf: a tiny effects rack' })}</span></li>
      <li>
        <span class="material-symbols-outlined feature-icon" aria-hidden="true">explore</span>
        <span>{$t('options.about.features.name', { default: '“izci” means “tracker” in Turkish*' })}<small class="feature-note">{$t('options.about.features.nameNote', { default: '*Umm actually it’s closer to “scout”. But it was cute and the name stuck' })}</small></span>
      </li>
    </ul>
  </div>

  <footer class="about-footer">
    {$t('options.about.credits', { default: 'izci uses Howler.js, Chiptune3 (based on libopenmpt), and Google Material Symbols.' })}
    {$t('options.about.seeFull', { default: 'See full' })}
    <a
      href={buildOptionsWindowPath('licenses')}
      on:click|preventDefault={onOpenLicenses}
    >{$t('options.about.thirdPartyLicenses', { default: 'third-party licenses' })}</a>.
  </footer>
</article>
