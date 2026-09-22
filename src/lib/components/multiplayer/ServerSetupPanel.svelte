<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
  import {
    serverRecents,
    serverServers
  } from '$lib/stores/multiplayer-server-recents';
  import {
    SERVER_SETUP_GUIDE_URL,
    serverSetup
  } from '$lib/services/multiplayer-server-setup';
  import { describeServerEndpoint } from '$lib/services/multiplayer-server-invite';

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

  async function join(): Promise<void> {
    await serverSetup.joinPending().catch(() => undefined);
  }

</script>

<div class="server-setup">
  {#if mode === 'config'}
    <section aria-label={$t('options.multiplayer.server.serverLabel', { default: 'Server address' })}>
      <label class="field-title" for="server-server-input">
        {$t('options.multiplayer.server.serverLabel', { default: 'Server address' })}
      </label>
      <div class="row">
        <input
          id="server-server-input"
          class="mono"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="https://server.example.com"
          value={setup.serverInput}
          disabled={setup.busy !== null}
          on:input={(event) => serverSetup.setServerInput(event.currentTarget.value)}
        />
        <button type="button" disabled={setup.busy !== null || !setup.serverInput.trim()} on:click={connect}>
          {$t('options.multiplayer.server.connect', { default: 'Connect' })}
        </button>
      </div>
      <p class="hint">{$t('options.multiplayer.server.serverHint', { default: '' })}</p>
      <div class="row">
        <button type="button" class="quiet" disabled={setup.busy !== null} on:click={() => serverSetup.useSameOrigin()}>
          {$t('options.multiplayer.server.useSameOrigin', { default: "Use this izci's address" })}
        </button>
      </div>
      <p class="hint">{$t('options.multiplayer.server.noDirectory', { default: '' })}</p>
      {#if setup.infoStatus === 'error'}
        <p class="error" role="alert">{setup.infoError}</p>
      {/if}
      {#if setup.serverInfo}
        <dl class="server-info">
          <div>
            <dt>{$t('options.multiplayer.server.serverLabel', { default: 'Server address' })}</dt>
            <dd class="mono">{setup.endpointDisplay}</dd>
          </div>
          <div>
            <dt>{$t('options.multiplayer.server.serverDescription', { default: 'Server description' })}</dt>
            <dd>{setup.serverInfo.description || '—'}</dd>
          </div>
          <div>
            <dt>{$t('options.multiplayer.server.serverContact', { default: 'Operator contact' })}</dt>
            <dd>{setup.serverInfo.contact || '—'}</dd>
          </div>
          <div>
            <dt>{$t('options.multiplayer.server.serverIce', { default: 'Declared ICE providers' })}</dt>
            <dd>
              {#if setup.serverInfo.iceUrls.length === 0}
                {$t('options.multiplayer.server.serverIceNone', { default: 'None declared' })}
              {:else}
                {setup.serverInfo.iceUrls.join(', ')}
              {/if}
            </dd>
          </div>
          <div>
            <dt>{$t('options.multiplayer.server.serverLimits', { default: 'Room limits' })}</dt>
            <dd>
              {setup.serverInfo.limits.maxRooms}/{setup.serverInfo.limits.maxPeersPerRoom}/{setup.serverInfo.limits.maxPendingAttemptsPerRoom}
            </dd>
          </div>
        </dl>
      {/if}
    </section>

    {#if setup.endpoint}
      <section aria-label={$t('options.multiplayer.server.loginTitle', { default: 'Host login' })}>
        <h4>{$t('options.multiplayer.server.loginTitle', { default: 'Host login' })}</h4>
        {#if setup.hasLogin}
          <p class="hint">{$t('options.multiplayer.server.configured', { default: 'Operator key verified and saved. Host is ready to use from the main window.' })}</p>
          <button type="button" class="quiet" disabled={setup.busy !== null} on:click={logout}>
            {$t('options.multiplayer.server.verifyAgain', { default: 'Enter a different key' })}
          </button>
        {:else}
          <label class="field-title" for="server-host-key">
            {$t('options.multiplayer.server.keyLabel', { default: 'Operator key' })}
          </label>
          <div class="row">
            <input
              id="server-host-key"
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
            <button type="button" disabled={setup.busy !== null || (!hostKey.trim() && !setup.hasSavedHostKey)} on:click={login}>
              {$t('options.multiplayer.server.verify', { default: 'Verify and save' })}
            </button>
          </div>
          <p class="hint">{$t('options.multiplayer.server.keyHint', { default: '' })}</p>
        {/if}
        {#if setup.error}
          <p class="error" role="alert">{setup.error}</p>
        {/if}
      </section>
    {/if}
  {:else}
    {#if setup.hosted}
      <section aria-label={$t('options.multiplayer.server.loginTitle', { default: 'Host login' })}>
          <p class="hint">{$t('options.multiplayer.server.hostInviteHint', { default: '' })}</p>
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
            <p class="hint">{$t('options.multiplayer.server.dedicatedHint', { default: 'This invitation joins the always-on izci-server host and its configured library.' })}</p>
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
          <p class="hint">{$t('options.multiplayer.server.loggedIn', { default: '' })}</p>
          <label class="check">
            <input
              type="checkbox"
              checked={setup.hostRemember}
              on:change={(event) => serverSetup.setHostRemember(event.currentTarget.checked)}
            />
            {$t('options.multiplayer.server.rememberHost', { default: 'Remember this room on this device' })}
          </label>
          <p class="hint">{$t('options.multiplayer.server.rememberHostHint', { default: '' })}</p>
          <div class="row">
            <button type="button" disabled={setup.busy !== null} on:click={createRoom}>
              {$t('options.multiplayer.server.createRoom', { default: 'Create room' })}
            </button>
            <button type="button" class="quiet" disabled={setup.busy !== null} on:click={logout}>
              {$t('options.multiplayer.server.logout', { default: 'Log out' })}
            </button>
          </div>
          {#if resumeCandidates.length > 0}
            <p class="hint">{$t('options.multiplayer.server.resumeHint', { default: '' })}</p>
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
          <p class="hint">{$t('options.multiplayer.server.pendingHint', { default: '' })}</p>
          <div class="row">
            <button
              type="button"
              disabled={setup.busy !== null || setup.guestStatus === 'connecting'}
              on:click={join}
            >
              {$t('options.multiplayer.server.join', { default: 'Join' })}
            </button>
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
  {/if}

  {#if mode === 'config'}
  <section aria-label={$t('options.multiplayer.server.noticeTitle', { default: 'Server and provider notice' })}>
    <h4>{$t('options.multiplayer.server.noticeTitle', { default: 'Server and provider notice' })}</h4>
    <p class="hint">{$t('options.multiplayer.server.noticeText', { default: '' })}</p>
    <p>
      <a href={SERVER_SETUP_GUIDE_URL} target="_blank" rel="noreferrer">
        {$t('options.multiplayer.server.guideLink', { default: 'Server setup guide' })}
      </a>
    </p>
  </section>

  <section aria-label={$t('options.multiplayer.server.labelTitle', { default: 'Server label' })}>
    <h4>{$t('options.multiplayer.server.labelTitle', { default: 'Server label' })}</h4>
    <input
      type="text"
      maxlength="120"
      value={$multiplayerSettings.multiplayerServerLabel}
      on:change={(event) => multiplayerSettings.update({ multiplayerServerLabel: event.currentTarget.value })}
    />
    <p class="hint">{$t('options.multiplayer.server.labelHint', { default: '' })}</p>
    <label class="check">
      <input
        type="checkbox"
        checked={$multiplayerSettings.multiplayerServerAutoReconnect}
        on:change={(event) => multiplayerSettings.update({
          multiplayerServerAutoReconnect: event.currentTarget.checked
        })}
      />
      {$t('options.multiplayer.server.autoReconnect', { default: 'Reconnect signaling automatically' })}
    </label>
    <p class="hint">{$t('options.multiplayer.server.autoReconnectHint', { default: '' })}</p>
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
    <p class="hint">{$t('options.multiplayer.server.forceRelayHint', { default: '' })}</p>
  </section>

  <section aria-label={$t('options.multiplayer.server.serversTitle', { default: 'Remembered servers' })}>
    <h4>{$t('options.multiplayer.server.serversTitle', { default: 'Remembered servers' })}</h4>
    {#if $serverServers.length === 0}
      <p class="hint">{$t('options.multiplayer.server.serversEmpty', { default: '' })}</p>
    {:else}
      <ul class="recents">
        {#each $serverServers as server (server.endpoint)}
          <li>
            <span class="mono">{describeEndpoint(server.endpoint)}</span>
            {#if server.label}<span class="recent-name">{server.label}</span>{/if}
            <button type="button" class="quiet" on:click={() => serverSetup.setServerInput(server.endpoint)}>
              {$t('options.multiplayer.server.useServer', { default: 'Use' })}
            </button>
            <button type="button" class="quiet danger" on:click={() => serverSetup.forgetServer(server.endpoint)}>
              {$t('options.multiplayer.server.forgetServer', { default: 'Forget server' })}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <h4>{$t('options.multiplayer.server.recentsTitle', { default: 'Remembered invitations' })}</h4>
    {#if $serverRecents.length === 0}
      <p class="hint">{$t('options.multiplayer.server.recentsEmpty', { default: '' })}</p>
    {:else}
      <ul class="recents">
        {#each $serverRecents as recent (`${recent.endpoint}::${recent.roomId}`)}
          <li>
            <span class="recent-name">{recent.displayName}</span>
            <span class="mono">{describeEndpoint(recent.endpoint)}</span>
            <button
              type="button"
              class="quiet danger"
              on:click={() => serverSetup.forgetInvitation(recent.endpoint, recent.roomId)}
            >
              {$t('options.multiplayer.server.forgetInvite', { default: 'Forget invitation' })}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
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

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 1.45;
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

  button.danger {
    color: var(--danger);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-strong);
  }

  .server-info {
    display: grid;
    gap: 0.25rem;
    margin: 0.25rem 0 0;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--border-faint);
    border-radius: 0.35rem;
    background: color-mix(in srgb, var(--bg-input) 72%, transparent);
  }

  .server-info > div {
    display: grid;
    grid-template-columns: 9rem minmax(0, 1fr);
    gap: 0.5rem;
  }

  .server-info dt {
    color: var(--muted-strong);
  }

  .server-info dd {
    margin: 0;
    overflow-wrap: anywhere;
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

  a {
    color: var(--accent-strong);
  }
</style>
