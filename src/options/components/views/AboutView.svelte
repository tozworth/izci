<script lang="ts">
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { platformCapabilities } from '$platform';
  import { version as appVersion } from '../../../../package.json';
  import {
    applyAvailableServiceWorkerUpdate,
    checkServiceWorkerUpdate,
    pwaUpdateCheckState
  } from '$lib/services/pwa-updates';
  import { formatDisplayVersion } from '$lib/utils/version';
  import { buildOptionsWindowPath } from '../../views';
  import AboutConstellation from '../about/AboutConstellation.svelte';
  import AboutSpace from '../about/AboutSpace.svelte';
  import AboutTip from '../about/AboutTip.svelte';

  export let onOpenLicenses: () => void;

  const displayVersion = formatDisplayVersion(appVersion);
  const codename = 'Expedition';

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
    if (platformCapabilities.serviceWorkerUpdates) void checkServiceWorkerUpdate();
  });
</script>

<article class="view about-view">
  <AboutSpace />
  <AboutTip />
  <div class="about-content">
    <div class="about-identity">
      <AboutConstellation />
      <h1 class="about-name">
        <span class="about-wordmark">izci</span>
        <span class="about-version">{displayVersion}</span>
        <span class="about-codename">“{codename}”</span>
      </h1>
      <p class="about-author">Toz · 2026</p>
    </div>
  </div>

  <footer class="about-details">
    <div class="about-links">
      <a
        href="https://github.com/tozworth/izci"
        target="_blank"
        rel="noreferrer"
        aria-label={$t('options.about.openOnGitHub', { default: 'Open tozworth/izci on GitHub' })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 .7a11.6 11.6 0 0 0-3.7 22.6c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.6 11.6 0 0 0 12 .7Z" />
        </svg>
        <span>tozworth/izci</span>
      </a>
      <a
        href="https://izci.xn--ala-hsa.net"
        target="_blank"
        rel="noreferrer"
        aria-label={$t('options.about.openHostedPwa', { default: 'Open izci.ağla.net, the publicly hosted PWA' })}
      >
        <span class="material-symbols-outlined" aria-hidden="true">public</span>
        <span>izci.ağla.net</span>
      </a>
    </div>

    {#if platformCapabilities.serviceWorkerUpdates}
    <div
      class="about-update-status"
      class:update-checking={$pwaUpdateCheckState.status === 'checking'}
      class:update-available={$pwaUpdateCheckState.status === 'available'}
      class:update-failed={$pwaUpdateCheckState.status === 'failed'}
      aria-live="polite"
    >
      <span class="about-update-indicator" aria-hidden="true"></span>
      <div class="about-update-copy">
        <strong>{updateStatusLabel}</strong>
        {#if $pwaUpdateCheckState.status === 'available'}
          <button type="button" on:click={() => void applyAvailableServiceWorkerUpdate()}>
            {$t('options.about.updates.apply', { default: 'Click to update and restart' })}
          </button>
        {:else}
          <span>{lastSuccessfulCheck}</span>
        {/if}
      </div>
      {#if $pwaUpdateCheckState.status === 'up-to-date' || $pwaUpdateCheckState.status === 'failed'}
        <button
          class="about-update-refresh"
          type="button"
          aria-label={$t('options.about.updates.checkAgain', { default: 'Check for updates again' })}
          title={$t('options.about.updates.checkAgain', { default: 'Check for updates again' })}
          on:click={() => void checkServiceWorkerUpdate()}
        >
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        </button>
      {/if}
    </div>
    {/if}

    <p class="about-credits">
      {$t('options.about.credits', { default: "izci wouldn't be possible without libopenmpt, HivelyTracker, Howler.js, and Mediabunny." })}
      <a
        href={buildOptionsWindowPath('licenses')}
        on:click|preventDefault={onOpenLicenses}
      >{$t('options.about.seeFull', { default: 'See full' })} {$t('options.about.thirdPartyLicenses', { default: 'third-party licenses' })}</a>.
    </p>
  </footer>
</article>

<style>
  .about-view {
    --about-small-font-size: 0.68rem;
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: auto;
    background: #050c19;
    color: #dce8f5;
    text-shadow: none;
  }

  .about-content {
    pointer-events: none;
    position: relative;
    display: grid;
    place-items: center;
    flex: 1 0 auto;
    min-height: 260px;
    padding: 14px 16px 22px;
  }

  .about-identity {
    pointer-events: auto;
    max-width: 100%;
    text-align: center;
  }

  .about-name {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: 0.4em;
    margin: 0;
    font-size: clamp(1rem, 3.2cqi, 1.45rem);
    font-weight: 400;
    line-height: 1.25;
  }

  .about-wordmark {
    color: #edf5ff;
    font-family: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 1.9em;
    font-weight: 600;
    letter-spacing: -0.065em;
  }

  .about-version,
  .about-codename {
    color: #9aaec7;
    font-size: 0.8em;
  }

  .about-author {
    margin: 3px 0 0;
    color: #8b9db6;
    font-size: var(--about-small-font-size);
  }

  .about-details {
    pointer-events: none;
    position: relative;
    flex: 0 0 auto;
    display: grid;
    justify-items: end;
    gap: 10px;
    padding: 16px 14px 12px;
    background: linear-gradient(transparent, #040a16b3 45%, #040a16eb);
    font-size: 0.68rem;
    line-height: 1.5;
  }

  a,
  button {
    color: #b8d7f4;
    cursor: default;
    text-shadow: none;
  }

  a:hover,
  button:hover {
    color: #f0f7ff;
  }

  a:focus-visible,
  button:focus-visible {
    outline: 1px solid #a8d6ff;
    outline-offset: 4px;
  }

  .about-links {
    pointer-events: auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px 18px;
    font-size: 0.72rem;
  }

  .about-links a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 0;
    text-decoration: none;
  }

  .about-links a:hover span:last-child {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .about-links svg {
    width: 13px;
    height: 13px;
  }

  .about-links .material-symbols-outlined {
    font-size: 15px;
  }

  .about-update-status {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    color: #9aaec7;
  }

  .about-update-indicator {
    flex: 0 0 auto;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #8ac8ac;
    box-shadow: 0 0 6px #8ac8ac55;
  }

  .update-checking .about-update-indicator {
    background: #9bbfea;
  }

  .update-available .about-update-indicator {
    background: #ffd094;
  }

  .update-failed .about-update-indicator {
    background: #efa1ac;
  }

  .about-update-copy {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: 2px 8px;
    min-width: 0;
  }

  .about-update-copy strong {
    font-weight: 500;
    color: #c6d6e9;
  }

  .about-update-copy button {
    padding: 0;
    background: transparent;
    font: inherit;
    text-align: right;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .about-update-refresh {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 3px;
    background: transparent;
  }

  .about-update-refresh:hover {
    background: #a8d6ff15;
  }

  .about-credits {
    pointer-events: auto;
    width: 100%;
    margin: 0;
    color: #9aaec7;
    font-size: 0.65rem;
    line-height: 1.5;
  }

  .about-credits a {
    text-underline-offset: 2px;
  }

  @container (max-width: 360px) {
    .about-content {
      padding-top: 28px;
    }

    .about-details {
      gap: 12px;
    }

    .about-update-copy {
      flex-direction: column;
      align-items: flex-end;
    }
  }
</style>
