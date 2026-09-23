<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
  import { serverRecents } from '$lib/stores/multiplayer-server-recents';
  import {
    SERVER_SETUP_GUIDE_URL,
    serverSetup
  } from '$lib/services/multiplayer-server-setup';
  import { describeServerEndpoint } from '$lib/services/multiplayer-server-invite';
import ServerJoinChoices from './ServerJoinChoices.svelte';
import SettingsField from '$lib/components/options/SettingsField.svelte';

  export let mode: 'full' | 'config' = 'full';

  let hostKey = '';
  let copied = false;
  let copyTimer: number | null = null;

  $: setup = $serverSetup;
  $: myRecents = $serverRecents.filter(
    (entry) => !setup.endpoint || entry.endpoint === setup.endpoint
  );
  $: resumeCandidates = myRecents.filter((entry) => entry.ownerSecret);

  onMount(() => {
    if (mode !== 'config' || serverSetup.getSnapshot().serverInput) return;
    const endpoint = multiplayerSettings.getSnapshot().multiplayerServerEndpoint;
    if (endpoint) serverSetup.setServerInput(endpoint);
  });

  function describeEndpoint(endpoint: string): string {
    try {
      return describeServerEndpoint(endpoint).authorityWithPrefix;
    } catch {
      return endpoint;
    }
  }

  async function connect(): Promise<void> {
    await serverSetup.connectServer().catch(() => undefined);
  }

  async function login(): Promise<void> {
    if (!hostKey.trim() && !setup.hasSavedHostKey) return;
    const key = hostKey;
    hostKey = '';
    serverSetup.setRememberHostKey(true);
    await serverSetup.login(key).catch(() => undefined);
  }

  async function logout(): Promise<void> {
    await serverSetup.logout().catch(() => undefined);
  }

  async function createRoom(): Promise<void> {
    await serverSetup.createRoom().catch(() => undefined);
  }

  async function resumeRoom(roomId: string, ownerSecret: string): Promise<void> {
    // Absent rooms (server restart, lapsed lease) are recreated with the
    // saved IDs so existing invite links keep working.
    await serverSetup.resumeOrRecreateRoom(roomId, ownerSecret).catch(() => undefined);
  }

  async function rotate(): Promise<void> {
    await serverSetup.rotateInvitation().catch(() => undefined);
  }

  async function closeRoom(): Promise<void> {
    await serverSetup.closeRoom().catch(() => undefined);
  }

  async function copyInvite(): Promise<void> {
    const link = setup.inviteLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt($t('options.multiplayer.server.copyInvite', { default: 'Copy invite' }), link);
      return;
    }
    copied = true;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copied = false;
    }, 2_000);
  }

  async function copyDedicatedInvite(): Promise<void> {
    const link = setup.dedicatedInviteLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt($t('options.multiplayer.server.copyDedicatedInvite', { default: 'Copy dedicated-server invite' }), link);
      return;
    }
    copied = true;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copied = false;
    }, 2_000);
  }

</script>

<div class="server-setup" class:config={mode === 'config'}>
  {#if mode === 'config'}
    <SettingsField
      title={$t('options.multiplayer.server.serverLabel', { default: 'Server address' })}
      controlClass="server-address-control"
    >
      <svelte:fragment slot="hint">
        {$t('options.multiplayer.server.serverHint', { default: '' })}{" "}
        {$t('options.multiplayer.server.noDirectory', { default: '' })}
      </svelte:fragment>
      <input
        class="server-address-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="https://server.example.com"
        value={setup.serverInput}
        disabled={setup.busy !== null}
        on:input={(event) => serverSetup.setServerInput(event.currentTarget.value)}
      />
      <button
        type="button"
        disabled={setup.busy !== null || !setup.serverInput.trim()}
        on:click={connect}
      >
        {$t('options.multiplayer.server.connect', { default: 'Connect' })}
      </button>
    </SettingsField>
    {#if setup.infoStatus === 'error'}
      <p class="error" role="alert">{setup.infoError}</p>
    {/if}
    {#if setup.serverInfo}
      <SettingsField
        title={$t('options.multiplayer.server.serverDescription', { default: 'Server description' })}
      >
        <span class="server-value">{setup.serverInfo.description || '—'}</span>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.server.serverContact', { default: 'Operator contact' })}
      >
        <span class="server-value">{setup.serverInfo.contact || '—'}</span>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.server.serverIce', { default: 'Declared ICE providers' })}
      >
        <span class="server-value">
          {#if setup.serverInfo.iceUrls.length === 0}
            {$t('options.multiplayer.server.serverIceNone', { default: 'None declared' })}
          {:else}
            {setup.serverInfo.iceUrls.join(', ')}
          {/if}
        </span>
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.server.serverLimits', { default: 'Room limits' })}
      >
        <span class="server-value">
          {setup.serverInfo.limits.maxRooms}/{setup.serverInfo.limits.maxPeersPerRoom}/{setup.serverInfo.limits.maxPendingAttemptsPerRoom}
        </span>
      </SettingsField>
    {/if}

    {#if setup.endpoint}
      {#if setup.hasLogin}
        <SettingsField
          useLabel={false}
          title={$t('options.multiplayer.server.loginTitle', { default: 'Host login' })}
          hint={$t('options.multiplayer.server.configured', { default: 'Operator key verified and saved. Host is ready to use from the main window.' })}
        >
          <button
            type="button"
            class="quiet"
            disabled={setup.busy !== null}
            on:click={logout}
          >
            {$t('options.multiplayer.server.verifyAgain', { default: 'Enter a different key' })}
          </button>
        </SettingsField>
      {:else}
        <SettingsField
          title={$t('options.multiplayer.server.keyLabel', { default: 'Operator key' })}
          hint={$t('options.multiplayer.server.keyHint', { default: '' })}
        >
          <input
            class="server-compact-input"
            type="password"
            autocomplete="off"
            placeholder={setup.hasSavedHostKey
              ? $t('options.multiplayer.server.savedKeyPlaceholder', { default: 'Saved on this device' })
              : ''}
            value={hostKey}
            disabled={setup.busy !== null}
            on:input={(event) => (hostKey = event.currentTarget.value)}
            on:keydown={(event) => {
              if (event.key === 'Enter') void login();
            }}
          />
          <button
            type="button"
            disabled={setup.busy !== null || (!hostKey.trim() && !setup.hasSavedHostKey)}
            on:click={login}
          >
            {$t('options.multiplayer.server.verify', { default: 'Verify and save' })}
          </button>
        </SettingsField>
      {/if}
      {#if setup.error}
        <p class="error" role="alert">{setup.error}</p>
      {/if}
    {/if}
    <SettingsField
      title={$t('options.multiplayer.server.forceRelay', { default: 'Prefer relayed routes' })}
      hint={$t('options.multiplayer.server.forceRelayHint', { default: '' })}
      checkbox
    >
      <input
        type="checkbox"
        checked={$multiplayerSettings.multiplayerServerForceRelay}
        on:change={(event) => multiplayerSettings.update({
          multiplayerServerForceRelay: event.currentTarget.checked
        })}
      />
    </SettingsField>
  {:else}
    {#if setup.hosted}
      <section aria-label={$t('options.multiplayer.server.loginTitle', { default: 'Host login' })}>
          <p class="field-hint">{$t('options.multiplayer.server.hostInviteHint', { default: '' })}</p>
          {#if setup.inviteLink}
            <div class="row">
              <input class="mono" type="text" readonly value={setup.inviteLink} aria-label={$t('options.multiplayer.server.copyInvite', { default: 'Copy invite' })} />
              <button type="button" disabled={setup.busy !== null} on:click={copyInvite}>
                {copied
                  ? $t('options.multiplayer.server.copied', { default: 'Copied' })
                  : $t('options.multiplayer.server.copyInvite', { default: 'Copy invite' })}
              </button>
            </div>
          {/if}
          <div class="row">
            <button type="button" disabled={setup.busy !== null} on:click={rotate}>
              {$t('options.multiplayer.server.rotateInvite', { default: 'Rotate invite' })}
            </button>
            <button type="button" disabled={setup.busy !== null} on:click={closeRoom}>
              {$t('options.multiplayer.server.closeRoom', { default: 'Close room' })}
            </button>
            <button type="button" class="quiet" disabled={setup.busy !== null} on:click={logout}>
              {$t('options.multiplayer.server.logout', { default: 'Log out' })}
            </button>
          </div>
      </section>
    {:else if setup.hasLogin}
      <section aria-label={$t('options.multiplayer.server.loginTitle', { default: 'Host login' })}>
          {#if setup.dedicatedInviteLink}
            <h4>{$t('options.multiplayer.server.dedicatedTitle', { default: 'Dedicated izci-server' })}</h4>
            <p class="field-hint">{$t('options.multiplayer.server.dedicatedHint', { default: 'This invitation joins the always-on izci-server host and its configured library.' })}</p>
            <div class="row">
              <input class="mono" type="text" readonly value={setup.dedicatedInviteLink} aria-label={$t('options.multiplayer.server.copyDedicatedInvite', { default: 'Copy dedicated-server invite' })} />
              <button type="button" disabled={setup.busy !== null} on:click={copyDedicatedInvite}>
                {copied
                  ? $t('options.multiplayer.server.copied', { default: 'Copied' })
                  : $t('options.multiplayer.server.copyDedicatedInvite', { default: 'Copy dedicated-server invite' })}
              </button>
            </div>
            <h4>{$t('options.multiplayer.server.browserHostTitle', { default: 'Host from this izci' })}</h4>
          {/if}
          <p class="field-hint">{$t('options.multiplayer.server.loggedIn', { default: '' })}</p>
          <label class="check">
            <input
              type="checkbox"
              checked={setup.hostRemember}
              on:change={(event) => serverSetup.setHostRemember(event.currentTarget.checked)}
            />
            {$t('options.multiplayer.server.rememberHost', { default: 'Remember this room on this device' })}
          </label>
          <p class="field-hint">{$t('options.multiplayer.server.rememberHostHint', { default: '' })}</p>
          <div class="row">
            <button type="button" disabled={setup.busy !== null} on:click={createRoom}>
              {$t('options.multiplayer.server.createRoom', { default: 'Create room' })}
            </button>
            <button type="button" class="quiet" disabled={setup.busy !== null} on:click={logout}>
              {$t('options.multiplayer.server.logout', { default: 'Log out' })}
            </button>
          </div>
          {#if resumeCandidates.length > 0}
            <p class="field-hint">{$t('options.multiplayer.server.resumeHint', { default: '' })}</p>
            <ul class="recents">
              {#each resumeCandidates as recent (recent.roomId)}
                <li>
                  <span class="recent-name">{recent.displayName}</span>
                  <button
                    type="button"
                    class="quiet"
                    disabled={setup.busy !== null || !recent.ownerSecret}
                    on:click={() => recent.ownerSecret && resumeRoom(recent.roomId, recent.ownerSecret)}
                  >
                    {$t('options.multiplayer.server.resumeRoom', { default: 'Resume' })}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {#if setup.error}
          <p class="error" role="alert">{setup.error}</p>
        {/if}
      </section>
    {/if}

    {#if setup.pendingInvitation}
      <section aria-label={$t('options.multiplayer.server.guestTitle', { default: 'Join with an invitation' })}>
        <h4>{$t('options.multiplayer.server.guestTitle', { default: 'Join with an invitation' })}</h4>
        {#if setup.pendingInvitation}
          {@const pending = setup.pendingInvitation}
          <p class="invite-destination">
            <span class="field-title">{$t('options.multiplayer.server.destination', { default: 'Server' })}</span>
            <span class="mono">{describeEndpoint(pending.endpoint)}</span>
          </p>
          {#if pending.title}
            <p class="invite-title">
              <span class="field-title">{$t('options.multiplayer.server.unverifiedTitle', { default: 'Unverified party title' })}</span>
              <span>{pending.title}</span>
            </p>
          {/if}
          <p class="field-hint">{$t('options.multiplayer.server.pendingHint', { default: '' })}</p>
          <ServerJoinChoices />
          <div class="row cancel-row">
            <button type="button" class="quiet" on:click={() => serverSetup.dismissPending()}>
              {$t('options.multiplayer.server.cancel', { default: 'Cancel' })}
            </button>
          </div>
          {#if setup.guestError}
            <p class="error" role="alert">{setup.guestError}</p>
          {/if}
        {/if}
      </section>
    {/if}

  <section aria-label={$t('options.multiplayer.server.forceRelay', { default: 'Prefer relayed routes' })}>
    <label class="check">
      <input
        type="checkbox"
        checked={$multiplayerSettings.multiplayerServerForceRelay}
        on:change={(event) => multiplayerSettings.update({
          multiplayerServerForceRelay: event.currentTarget.checked
        })}
      />
      {$t('options.multiplayer.server.forceRelay', { default: 'Prefer relayed routes' })}
    </label>
    <p class="field-hint">{$t('options.multiplayer.server.forceRelayHint', { default: '' })}</p>
  </section>

  {/if}
</div>

<style>
  .server-setup {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    font-size: 0.74rem;
  }

  /* Config mode renders plain SettingsField rows into the Options
     field-grid, so the wrapper vanishes and rows flow with the rest. */
  .server-setup.config {
    display: contents;
  }

  .server-setup.config > :global(.field):first-child {
    border-top: 0;
  }

  .server-setup :global(.server-address-control) {
    flex-wrap: wrap;
  }

  .server-setup input.server-compact-input {
    width: min(12rem, 26vw);
  }

  .server-setup input.server-address-input {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .server-value {
    overflow-wrap: anywhere;
    text-align: right;
    font-size: 0.8rem;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border-faint);
  }

  section:first-child {
    padding-top: 0;
    border-top: none;
  }

  h4 {
    margin: 0;
    color: var(--text-strong);
    font-size: 0.76rem;
  }

  .field-title {
    color: var(--muted-strong);
    font-size: 0.68rem;
    font-weight: 650;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 0.7rem;
  }

  .row {
    display: flex;
    gap: 0.4rem;
  }

  .row input {
    flex: 1;
    min-width: 0;
  }

  .row.cancel-row {
    justify-content: flex-end;
  }

  input[type='text'],
  input[type='password'] {
    padding: 0.28rem 0.45rem;
    border: 1px solid var(--border-soft);
    border-radius: 0.3rem;
    background: var(--bg-input);
    color: inherit;
    font: inherit;
  }

  input.mono,
  .mono {
    font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
    font-size: 0.7rem;
  }

  button {
    flex: 0 0 auto;
    padding: 0.28rem 0.65rem;
    border: 1px solid var(--menu-bar-border);
    border-radius: 0.3rem;
    background: var(--bg-input);
    color: var(--text-strong);
    font: inherit;
  }

  button:hover:not(:disabled) {
    background: var(--hover-surface);
  }

  button:disabled {
    opacity: 0.55;
  }

  button.quiet {
    border-color: transparent;
    background: transparent;
    color: var(--muted-strong);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-strong);
  }

  .invite-destination,
  .invite-title {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .recents {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .recents li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
  }

  .recent-name {
    color: var(--text-strong);
    font-weight: 650;
  }
</style>
