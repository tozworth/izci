<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import type {
    MultiplayerClient,
    MultiplayerAudioStatus,
    MultiplayerConnectionStatus,
    MultiplayerMode
  } from '$lib/services/multiplayer-session';
  import type { MultiplayerConnectionRoute } from '$lib/services/multiplayer-ice';
  import type { MultiplayerRecent } from '$lib/stores/multiplayer-recents';
  import type { MultiplayerPairing } from '$lib/stores/multiplayer-pairings';

  export let open = false;
  export let installAvailable = false;
  export let videoAvailable = false;
  export let patternsVisible = false;
  export let multiplayerEnabled = false;
  export let multiplayerMode: MultiplayerMode = 'idle';
  export let multiplayerConnectionStatus: MultiplayerConnectionStatus = 'idle';
  export let multiplayerReconnecting = false;
  export let multiplayerAudioStatus: MultiplayerAudioStatus = 'idle';
  export let multiplayerConnectionRoute: MultiplayerConnectionRoute | null = null;
  export let multiplayerAudioBitrateKbps: number | null = null;
  export let multiplayerInviteCode: string | null = null;
  export let multiplayerHostName: string | null = null;
  export let multiplayerClients: MultiplayerClient[] = [];
  export let multiplayerRecents: MultiplayerRecent[] = [];
  export let multiplayerPairings: MultiplayerPairing[] = [];

  type DrawerAction =
    | 'openFiles'
    | 'openFolder'
    | 'manageFolders'
    | 'showPatterns'
    | 'showVideo'
    | 'openOptions'
    | 'openAbout'
    | 'install'
    | 'multiplayerHost'
    | 'multiplayerStopHosting'
    | 'multiplayerJoin'
    | 'multiplayerLeave'
    | 'multiplayerCopyInvite'
    | 'multiplayerResumeAudio';

  const dispatch = createEventDispatcher<{
    close: void;
    openFiles: void;
    openFolder: void;
    manageFolders: void;
    showPatterns: void;
    showVideo: void;
    openOptions: void;
    openAbout: void;
    install: void;
    multiplayerHost: void;
    multiplayerStopHosting: void;
    multiplayerJoin: void;
    multiplayerJoinRecent: string;
    multiplayerJoinPaired: string;
    multiplayerForgetPairing: string;
    multiplayerLeave: void;
    multiplayerCopyInvite: void;
    multiplayerResumeAudio: void;
    multiplayerKick: string;
    multiplayerTogglePair: string;
  }>();

  function run(action: DrawerAction): void {
    dispatch(action, undefined);
    dispatch('close');
  }

  function runWithDetail(
    action: 'multiplayerJoinRecent'
      | 'multiplayerJoinPaired'
      | 'multiplayerForgetPairing'
      | 'multiplayerKick'
      | 'multiplayerTogglePair',
    detail: string
  ): void {
    dispatch(action, detail);
    dispatch('close');
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      dispatch('close');
    }
  }

  function multiplayerAudioStatusLabel(status: MultiplayerAudioStatus, route: MultiplayerConnectionRoute | null, bitrateKbps: number | null): string {
    const stateLabel = status === 'playing'
      ? $t('main.multiplayer.audio.listening', { default: 'Listening' })
      : status === 'blocked'
        ? $t('main.multiplayer.audio.blocked', { default: 'Audio needs permission' })
        : status === 'disabled'
          ? $t('main.multiplayer.audio.disabled', { default: 'Host audio is off' })
          : status === 'video-disabled'
            ? $t('main.multiplayer.audio.videoDisabled', { default: 'Video audio is off' })
            : status === 'unavailable'
              ? $t('main.multiplayer.audio.unavailable', { default: 'Audio unavailable' })
              : $t('main.multiplayer.audio.connecting', { default: 'Audio connecting...' });
    const routeLabel = route === 'direct'
      ? $t('main.multiplayer.route.direct', { default: 'Direct' })
      : route === 'relayed'
        ? $t('main.multiplayer.route.relayed', { default: 'Relayed' })
        : null;
    return [stateLabel, routeLabel, status === 'playing' && bitrateKbps !== null ? `${bitrateKbps} kbps` : null]
      .filter(Boolean)
      .join(' · ');
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <button
    class="mobile-drawer-scrim"
    type="button"
    aria-label={$t('mobile.menu.close', { default: 'Close menu' })}
    on:click={() => dispatch('close')}
  ></button>
{/if}

<aside class="mobile-drawer" class:is-open={open} aria-hidden={!open} aria-label={$t('mobile.menu.label', { default: 'Main menu' })}>
  <header class="mobile-drawer-header">
    <img src="/icons/izci-mark.svg" alt="" />
    <div>
      <strong>izci</strong>
      <span>{$t('mobile.menu.offlinePlayer', { default: 'Offline media player' })}</span>
    </div>
    <button type="button" aria-label={$t('mobile.menu.close', { default: 'Close menu' })} on:click={() => dispatch('close')}>
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
  </header>

  <nav class="mobile-drawer-content">
    <section>
      <h2>{$t('mobile.menu.addMedia', { default: 'Add media' })}</h2>
      <button type="button" on:click={() => run('openFiles')}>
        <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
        <span>{$t('main.menu.openFiles', { default: 'Open files...' })}</span>
      </button>
      <button type="button" on:click={() => run('openFolder')}>
        <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
        <span>{$t('main.menu.openFolder', { default: 'Open folder...' })}</span>
      </button>
      <button type="button" on:click={() => run('manageFolders')}>
        <span class="material-symbols-outlined" aria-hidden="true">folder_copy</span>
        <span>{$t('main.menu.manageFolders', { default: 'Manage folders...' })}</span>
      </button>
    </section>

    <section>
      <h2>{$t('main.menu.view', { default: 'View' })}</h2>
      <button type="button" class:active={patternsVisible} on:click={() => run('showPatterns')}>
        <span class="material-symbols-outlined" aria-hidden="true">view_timeline</span>
        <span>{$t('main.menu.patterns', { default: 'Patterns' })}</span>
      </button>
      {#if videoAvailable}
        <button type="button" on:click={() => run('showVideo')}>
          <span class="material-symbols-outlined" aria-hidden="true">movie</span>
          <span>{$t('main.video.menu', { default: 'Video' })}</span>
        </button>
      {/if}
    </section>

    {#if multiplayerEnabled}
      <section>
        <h2>{$t('main.multiplayer.label', { default: 'Multiplayer' })}</h2>
        {#if multiplayerMode === 'idle'}
          <button type="button" on:click={() => run('multiplayerHost')}>
            <span class="material-symbols-outlined" aria-hidden="true">cast</span>
            <span>{$t('main.multiplayer.host', { default: 'Host' })}</span>
          </button>
          <button type="button" on:click={() => run('multiplayerJoin')}>
            <span class="material-symbols-outlined" aria-hidden="true">cast_connected</span>
            <span>{$t('main.multiplayer.join', { default: 'Join...' })}</span>
          </button>
          {#if multiplayerPairings.length > 0}
            <div class="mobile-drawer-subheading">{$t('main.multiplayer.pairedHosts', { default: 'Paired hosts' })}</div>
            {#each multiplayerPairings as pairing (pairing.hostId)}
              <button type="button" on:click={() => runWithDetail('multiplayerJoinPaired', pairing.hostId)}>
                <span class="material-symbols-outlined" aria-hidden="true">cast_connected</span>
                <span>{pairing.name}</span>
              </button>
              <button type="button" on:click={() => runWithDetail('multiplayerForgetPairing', pairing.hostId)}>
                <span class="material-symbols-outlined" aria-hidden="true">link_off</span>
                <span>{$t('main.multiplayer.forgetPairing', {
                  default: 'Forget pairing with {name}',
                  values: { name: pairing.name }
                })}</span>
              </button>
            {/each}
          {/if}
          {#if multiplayerRecents.length > 0}
            <div class="mobile-drawer-subheading">{$t('main.multiplayer.recents', { default: 'Recents' })}</div>
            {#each multiplayerRecents as recent (recent.inviteCode)}
              <button type="button" on:click={() => runWithDetail('multiplayerJoinRecent', recent.inviteCode)}>
                <span class="material-symbols-outlined" aria-hidden="true">history</span>
                <span>{recent.name}</span>
              </button>
            {/each}
          {/if}
        {:else if multiplayerMode === 'hosting'}
          <div class="mobile-drawer-status">
            <span class="material-symbols-outlined" aria-hidden="true">cast_connected</span>
            <span>
              <strong>{$t('main.multiplayer.hosting', { default: 'Hosting' })}</strong>
              {#if multiplayerInviteCode}<small>{multiplayerInviteCode}</small>{/if}
            </span>
          </div>
          <button type="button" on:click={() => run('multiplayerCopyInvite')}>
            <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
            <span>{$t('main.multiplayer.copyInvite', { default: 'Copy invite code' })}</span>
          </button>
          <button type="button" on:click={() => run('multiplayerStopHosting')}>
            <span class="material-symbols-outlined" aria-hidden="true">cast_off</span>
            <span>{$t('main.multiplayer.stopHosting', { default: 'Stop hosting' })}</span>
          </button>
          {#each multiplayerClients as client (client.id)}
            <button
              type="button"
              disabled={client.status !== 'connected'}
              on:click={() => runWithDetail('multiplayerTogglePair', client.id)}
            >
              <span class="material-symbols-outlined" aria-hidden="true">{client.paired ? 'link_off' : 'link'}</span>
              <span>{client.paired
                ? $t('main.multiplayer.unpairClient', {
                    default: 'Unpair {name}',
                    values: { name: client.name }
                  })
                : $t('main.multiplayer.pairClientMobile', {
                    default: 'Pair {name}',
                    values: { name: client.name }
                  })}</span>
            </button>
            <button type="button" on:click={() => runWithDetail('multiplayerKick', client.id)}>
              <span class="material-symbols-outlined" aria-hidden="true">person_remove</span>
              <span>{$t('main.multiplayer.kick', { default: 'Kick {name}', values: { name: client.name } })}</span>
            </button>
          {/each}
        {:else}
          <div
            class="mobile-drawer-status"
            class:is-disconnected={!multiplayerReconnecting && (multiplayerConnectionStatus === 'disconnected' || multiplayerConnectionStatus === 'error')}
            class:is-reconnecting={multiplayerReconnecting}
            class:is-relayed={multiplayerConnectionStatus === 'connected' && multiplayerConnectionRoute === 'relayed'}
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              {multiplayerConnectionStatus === 'connected' ? 'cast_connected' : 'signal_disconnected'}
            </span>
            <span>
              <strong>{multiplayerHostName ?? $t('main.multiplayer.connecting', { default: 'Connecting...' })}</strong>
              <small>{multiplayerConnectionStatus === 'connected'
                ? multiplayerAudioStatusLabel(multiplayerAudioStatus, multiplayerConnectionRoute, multiplayerAudioBitrateKbps)
                : multiplayerConnectionStatus === 'connecting'
                  ? $t('main.multiplayer.connecting', { default: 'Connecting...' })
                  : $t('main.multiplayer.disconnected', { default: 'Disconnected' })}</small>
            </span>
          </div>
          {#if multiplayerAudioStatus === 'blocked'}
            <button type="button" on:click={() => run('multiplayerResumeAudio')}>
              <span class="material-symbols-outlined" aria-hidden="true">play_circle</span>
              <span>{$t('main.multiplayer.startListening', { default: 'Start listening' })}</span>
            </button>
          {/if}
          <button type="button" on:click={() => run('multiplayerLeave')}>
            <span class="material-symbols-outlined" aria-hidden="true">logout</span>
            <span>{$t('main.multiplayer.leave', { default: 'Leave' })}</span>
          </button>
        {/if}
      </section>
    {/if}

    <section>
      <h2>{$t('mobile.menu.app', { default: 'App' })}</h2>
      <button type="button" on:click={() => run('openOptions')}>
        <span class="material-symbols-outlined" aria-hidden="true">settings</span>
        <span>{$t('main.menu.options', { default: 'Options...' })}</span>
      </button>
      {#if installAvailable}
        <button type="button" on:click={() => run('install')}>
          <span class="material-symbols-outlined" aria-hidden="true">install_mobile</span>
          <span>{$t('main.menu.installApp', { default: 'Install izci...' })}</span>
        </button>
      {/if}
      <button type="button" on:click={() => run('openAbout')}>
        <span class="material-symbols-outlined" aria-hidden="true">info</span>
        <span>{$t('main.menu.about', { default: 'About' })}</span>
      </button>
    </section>
  </nav>
</aside>
