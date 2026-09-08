<script lang="ts">
  import { t } from 'svelte-i18n';
  import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
  import {
    sidekickRecents,
    sidekickServers
  } from '$lib/stores/multiplayer-sidekick-recents';
  import {
    SIDEKICK_PROVIDER_NOTICE_VERSION,
    SIDEKICK_SETUP_GUIDE_URL,
    sidekickSetup
  } from '$lib/services/multiplayer-sidekick-setup';
  import {
    describeSidekickEndpoint,
    parseSidekickInvitation,
    parseSidekickInviteHash,
    SidekickInviteError
  } from '$lib/services/multiplayer-sidekick-invite';

  export let mode: 'full' | 'config' = 'full';

  let hostKey = '';
  let paste = '';
  let pasteError: string | null = null;
  let copied = false;
  let copyTimer: number | null = null;

  $: setup = $sidekickSetup;
  $: acknowledged = $multiplayerSettings.multiplayerSidekickNoticeVersion
    >= SIDEKICK_PROVIDER_NOTICE_VERSION;
  $: myRecents = $sidekickRecents.filter(
    (entry) => !setup.endpoint || entry.endpoint === setup.endpoint
  );
  $: resumeCandidates = myRecents.filter((entry) => entry.ownerSecret);

  function describeEndpoint(endpoint: string): string {
    try {
      return describeSidekickEndpoint(endpoint).authorityWithPrefix;
    } catch {
      return endpoint;
    }
  }

  async function connect(): Promise<void> {
    await sidekickSetup.connectServer().catch(() => undefined);
  }

  async function login(): Promise<void> {
    if (!hostKey.trim()) return;
    const key = hostKey;
    hostKey = '';
    await sidekickSetup.login(key).catch(() => undefined);
  }

  async function logout(): Promise<void> {
    await sidekickSetup.logout().catch(() => undefined);
  }

  async function createRoom(): Promise<void> {
    await sidekickSetup.createRoom().catch(() => undefined);
  }

  async function resumeRoom(roomId: string, ownerSecret: string): Promise<void> {
    await sidekickSetup.resumeRoom(roomId, ownerSecret).catch(() => undefined);
  }

  async function rotate(): Promise<void> {
    await sidekickSetup.rotateInvitation().catch(() => undefined);
  }

  async function closeRoom(): Promise<void> {
    await sidekickSetup.closeRoom().catch(() => undefined);
  }

  async function copyInvite(): Promise<void> {
    const link = setup.inviteLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt($t('options.multiplayer.sidekick.copyInvite', { default: 'Copy invite' }), link);
      return;
    }
    copied = true;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copied = false;
    }, 2_000);
  }

  function checkPaste(): void {
    pasteError = null;
    const hashIndex = paste.indexOf('#');
    const hash = hashIndex >= 0 ? paste.slice(hashIndex) : paste;
    const raw = parseSidekickInviteHash(hash) ?? paste.trim();
    try {
      sidekickSetup.captureInvitation(parseSidekickInvitation(raw));
      paste = '';
    } catch (error) {
      pasteError = error instanceof SidekickInviteError ? error.code : 'bad-payload';
    }
  }

  async function join(): Promise<void> {
    await sidekickSetup.joinPending().catch(() => undefined);
  }

  async function continueWithProviders(): Promise<void> {
    await sidekickSetup.acknowledgeProvidersAndConnect().catch(() => undefined);
  }
</script>

<div class="sidekick-setup">
  {#if mode === 'full'}
    <section aria-label={$t('options.multiplayer.sidekick.serverLabel', { default: 'Server address' })}>
      <label class="field-title" for="sidekick-server-input">
        {$t('options.multiplayer.sidekick.serverLabel', { default: 'Server address' })}
      </label>
      <div class="row">
        <input
          id="sidekick-server-input"
          class="mono"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="https://sidekick.example.com"
          value={setup.serverInput}
          disabled={setup.busy !== null}
          on:input={(event) => sidekickSetup.setServerInput(event.currentTarget.value)}
        />
        <button type="button" disabled={setup.busy !== null || !setup.serverInput.trim()} on:click={connect}>
          {$t('options.multiplayer.sidekick.connect', { default: 'Connect' })}
        </button>
      </div>
      <p class="hint">{$t('options.multiplayer.sidekick.serverHint', { default: '' })}</p>
      <div class="row">
        <button type="button" class="quiet" disabled={setup.busy !== null} on:click={() => sidekickSetup.useSameOrigin()}>
          {$t('options.multiplayer.sidekick.useSameOrigin', { default: "Use this izci's address" })}
        </button>
      </div>
      <p class="hint">{$t('options.multiplayer.sidekick.noDirectory', { default: '' })}</p>
      {#if setup.infoStatus === 'error'}
        <p class="error" role="alert">{setup.infoError}</p>
      {/if}
      {#if setup.serverInfo}
        <dl class="server-info">
          <div>
            <dt>{$t('options.multiplayer.sidekick.serverLabel', { default: 'Server address' })}</dt>
            <dd class="mono">{setup.endpointDisplay}</dd>
          </div>
          <div>
            <dt>{$t('options.multiplayer.sidekick.serverDescription', { default: 'Server description' })}</dt>
            <dd>{setup.serverInfo.description || '—'}</dd>
          </div>
          <div>
            <dt>{$t('options.multiplayer.sidekick.serverContact', { default: 'Operator contact' })}</dt>
            <dd>{setup.serverInfo.contact || '—'}</dd>
          </div>
          <div>
            <dt>{$t('options.multiplayer.sidekick.serverIce', { default: 'Declared ICE providers' })}</dt>
            <dd>
              {#if setup.serverInfo.iceUrls.length === 0}
                {$t('options.multiplayer.sidekick.serverIceNone', { default: 'None declared' })}
              {:else}
                {setup.serverInfo.iceUrls.join(', ')}
              {/if}
            </dd>
          </div>
          <div>
            <dt>{$t('options.multiplayer.sidekick.serverLimits', { default: 'Room limits' })}</dt>
            <dd>
              {setup.serverInfo.limits.maxRooms}/{setup.serverInfo.limits.maxPeersPerRoom}/{setup.serverInfo.limits.maxPendingAttemptsPerRoom}
            </dd>
          </div>
        </dl>
      {/if}
    </section>

    {#if setup.endpoint}
      <section aria-label={$t('options.multiplayer.sidekick.loginTitle', { default: 'Host login' })}>
        <h4>{$t('options.multiplayer.sidekick.loginTitle', { default: 'Host login' })}</h4>
        {#if setup.hosted}
          <p class="hint">{$t('options.multiplayer.sidekick.hostInviteHint', { default: '' })}</p>
          {#if setup.inviteLink}
            <div class="row">
              <input class="mono" type="text" readonly value={setup.inviteLink} aria-label={$t('options.multiplayer.sidekick.copyInvite', { default: 'Copy invite' })} />
              <button type="button" disabled={setup.busy !== null} on:click={copyInvite}>
                {copied
                  ? $t('options.multiplayer.sidekick.copied', { default: 'Copied' })
                  : $t('options.multiplayer.sidekick.copyInvite', { default: 'Copy invite' })}
              </button>
            </div>
          {/if}
          <div class="row">
            <button type="button" disabled={setup.busy !== null} on:click={rotate}>
              {$t('options.multiplayer.sidekick.rotateInvite', { default: 'Rotate invite' })}
            </button>
            <button type="button" disabled={setup.busy !== null} on:click={closeRoom}>
              {$t('options.multiplayer.sidekick.closeRoom', { default: 'Close room' })}
            </button>
            <button type="button" class="quiet" disabled={setup.busy !== null} on:click={logout}>
              {$t('options.multiplayer.sidekick.logout', { default: 'Log out' })}
            </button>
          </div>
        {:else if setup.hasLogin}
          <p class="hint">{$t('options.multiplayer.sidekick.loggedIn', { default: '' })}</p>
          <label class="check">
            <input
              type="checkbox"
              checked={setup.hostRemember}
              on:change={(event) => sidekickSetup.setHostRemember(event.currentTarget.checked)}
            />
            {$t('options.multiplayer.sidekick.rememberHost', { default: 'Remember this room on this device' })}
          </label>
          <p class="hint">{$t('options.multiplayer.sidekick.rememberHostHint', { default: '' })}</p>
          {#if !acknowledged}
            <p class="hint">{$t('options.multiplayer.sidekick.noticeRequired', { default: '' })}</p>
          {/if}
          <div class="row">
            <button type="button" disabled={setup.busy !== null || !acknowledged} on:click={createRoom}>
              {$t('options.multiplayer.sidekick.createRoom', { default: 'Create room' })}
            </button>
            <button type="button" class="quiet" disabled={setup.busy !== null} on:click={logout}>
              {$t('options.multiplayer.sidekick.logout', { default: 'Log out' })}
            </button>
          </div>
          {#if resumeCandidates.length > 0}
            <p class="hint">{$t('options.multiplayer.sidekick.resumeHint', { default: '' })}</p>
            <ul class="recents">
              {#each resumeCandidates as recent (recent.roomId)}
                <li>
                  <span class="recent-name">{recent.displayName}</span>
                  <button
                    type="button"
                    class="quiet"
                    disabled={setup.busy !== null || !recent.ownerSecret || !acknowledged}
                    on:click={() => recent.ownerSecret && resumeRoom(recent.roomId, recent.ownerSecret)}
                  >
                    {$t('options.multiplayer.sidekick.resumeRoom', { default: 'Resume' })}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <label class="field-title" for="sidekick-host-key">
            {$t('options.multiplayer.sidekick.keyLabel', { default: 'Operator key' })}
          </label>
          <div class="row">
            <input
              id="sidekick-host-key"
              type="password"
              autocomplete="off"
              value={hostKey}
              disabled={setup.busy !== null}
              on:input={(event) => (hostKey = event.currentTarget.value)}
              on:keydown={(event) => {
                if (event.key === 'Enter') void login();
              }}
            />
            <button type="button" disabled={setup.busy !== null || !hostKey.trim()} on:click={login}>
              {$t('options.multiplayer.sidekick.login', { default: 'Log in' })}
            </button>
          </div>
          <p class="hint">{$t('options.multiplayer.sidekick.keyHint', { default: '' })}</p>
        {/if}
        {#if setup.error}
          <p class="error" role="alert">{setup.error}</p>
        {/if}
      </section>
    {/if}

    {#if setup.pendingInvitation || setup.endpoint}
      <section aria-label={$t('options.multiplayer.sidekick.guestTitle', { default: 'Join with an invitation' })}>
        <h4>{$t('options.multiplayer.sidekick.guestTitle', { default: 'Join with an invitation' })}</h4>
        {#if setup.pendingInvitation}
          {@const pending = setup.pendingInvitation}
          <p class="invite-destination">
            <span class="field-title">{$t('options.multiplayer.sidekick.destination', { default: 'Server' })}</span>
            <span class="mono">{describeEndpoint(pending.endpoint)}</span>
          </p>
          {#if pending.title}
            <p class="invite-title">
              <span class="field-title">{$t('options.multiplayer.sidekick.unverifiedTitle', { default: 'Unverified party title' })}</span>
              <span>{pending.title}</span>
            </p>
          {/if}
          <p class="hint">{$t('options.multiplayer.sidekick.pendingHint', { default: '' })}</p>
          {#if setup.guestStatus === 'awaiting-providers' && setup.guestInfo}
            <p class="field-title">{$t('options.multiplayer.sidekick.providersTitle', { default: 'The server declares these ICE providers' })}</p>
            <ul class="providers">
              {#each setup.guestInfo.iceUrls as url (url)}
                <li class="mono">{url}</li>
              {/each}
            </ul>
            <p class="hint">{$t('options.multiplayer.sidekick.providersHint', { default: '' })}</p>
            <div class="row">
              <button type="button" disabled={setup.busy !== null} on:click={continueWithProviders}>
                {$t('options.multiplayer.sidekick.continue', { default: 'Continue' })}
              </button>
              <button type="button" class="quiet" on:click={() => sidekickSetup.cancelCurrent()}>
                {$t('options.multiplayer.sidekick.cancel', { default: 'Cancel' })}
              </button>
            </div>
          {:else}
            <label class="check">
              <input
                type="checkbox"
                checked={setup.pendingRemember}
                on:change={(event) => sidekickSetup.setPendingRemember(event.currentTarget.checked)}
              />
              {$t('options.multiplayer.sidekick.rememberInvite', { default: 'Remember invitation on this device' })}
            </label>
            {#if !acknowledged}
              <p class="hint">{$t('options.multiplayer.sidekick.noticeRequired', { default: '' })}</p>
            {/if}
            <div class="row">
              <button
                type="button"
                disabled={setup.busy !== null || setup.guestStatus === 'connecting' || !acknowledged}
                on:click={join}
              >
                {$t('options.multiplayer.sidekick.join', { default: 'Join' })}
              </button>
              <button type="button" class="quiet" on:click={() => sidekickSetup.dismissPending()}>
                {$t('options.multiplayer.sidekick.cancel', { default: 'Cancel' })}
              </button>
            </div>
          {/if}
          {#if setup.guestError}
            <p class="error" role="alert">{setup.guestError}</p>
          {/if}
        {:else}
          <label class="field-title" for="sidekick-paste">
            {$t('options.multiplayer.sidekick.pasteLabel', { default: 'Invitation link' })}
          </label>
          <div class="row">
            <input
              id="sidekick-paste"
              class="mono"
              type="text"
              spellcheck="false"
              autocomplete="off"
              placeholder="#party=…"
              value={paste}
              on:input={(event) => (paste = event.currentTarget.value)}
              on:keydown={(event) => {
                if (event.key === 'Enter') checkPaste();
              }}
            />
            <button type="button" disabled={!paste.trim()} on:click={checkPaste}>
              {$t('options.multiplayer.sidekick.capture', { default: 'Check invitation' })}
            </button>
          </div>
          <p class="hint">{$t('options.multiplayer.sidekick.pasteHint', { default: '' })}</p>
          {#if pasteError}
            <p class="error" role="alert">{pasteError}</p>
          {/if}
        {/if}
      </section>
    {/if}
  {:else}
    <p class="hint">{$t('options.multiplayer.sidekick.needsMainWindow', { default: '' })}</p>
  {/if}

  <section aria-label={$t('options.multiplayer.sidekick.noticeTitle', { default: 'Server and provider notice' })}>
    <h4>{$t('options.multiplayer.sidekick.noticeTitle', { default: 'Server and provider notice' })}</h4>
    <p class="hint">{$t('options.multiplayer.sidekick.noticeText', { default: '' })}</p>
    {#if acknowledged}
      <p class="hint">{$t('options.multiplayer.sidekick.acknowledged', { default: 'Acknowledged' })}</p>
    {:else}
      <button type="button" on:click={() => sidekickSetup.acknowledgeNotice()}>
        {$t('options.multiplayer.sidekick.acknowledge', { default: 'Acknowledge' })}
      </button>
    {/if}
    <p>
      <a href={SIDEKICK_SETUP_GUIDE_URL} target="_blank" rel="noreferrer">
        {$t('options.multiplayer.sidekick.guideLink', { default: 'Sidekick setup guide' })}
      </a>
    </p>
  </section>

  <section aria-label={$t('options.multiplayer.sidekick.labelTitle', { default: 'Server label' })}>
    <h4>{$t('options.multiplayer.sidekick.labelTitle', { default: 'Server label' })}</h4>
    <input
      type="text"
      maxlength="120"
      value={$multiplayerSettings.multiplayerSidekickLabel}
      on:change={(event) => multiplayerSettings.update({ multiplayerSidekickLabel: event.currentTarget.value })}
    />
    <p class="hint">{$t('options.multiplayer.sidekick.labelHint', { default: '' })}</p>
    <label class="check">
      <input
        type="checkbox"
        checked={$multiplayerSettings.multiplayerSidekickAutoReconnect}
        on:change={(event) => multiplayerSettings.update({
          multiplayerSidekickAutoReconnect: event.currentTarget.checked
        })}
      />
      {$t('options.multiplayer.sidekick.autoReconnect', { default: 'Reconnect signaling automatically' })}
    </label>
    <p class="hint">{$t('options.multiplayer.sidekick.autoReconnectHint', { default: '' })}</p>
    <label class="check">
      <input
        type="checkbox"
        checked={$multiplayerSettings.multiplayerSidekickForceRelay}
        on:change={(event) => multiplayerSettings.update({
          multiplayerSidekickForceRelay: event.currentTarget.checked
        })}
      />
      {$t('options.multiplayer.sidekick.forceRelay', { default: 'Prefer relayed routes' })}
    </label>
    <p class="hint">{$t('options.multiplayer.sidekick.forceRelayHint', { default: '' })}</p>
  </section>

  <section aria-label={$t('options.multiplayer.sidekick.serversTitle', { default: 'Remembered servers' })}>
    <h4>{$t('options.multiplayer.sidekick.serversTitle', { default: 'Remembered servers' })}</h4>
    {#if $sidekickServers.length === 0}
      <p class="hint">{$t('options.multiplayer.sidekick.serversEmpty', { default: '' })}</p>
    {:else}
      <ul class="recents">
        {#each $sidekickServers as server (server.endpoint)}
          <li>
            <span class="mono">{describeEndpoint(server.endpoint)}</span>
            {#if server.label}<span class="recent-name">{server.label}</span>{/if}
            {#if mode === 'full'}
              <button type="button" class="quiet" on:click={() => sidekickSetup.setServerInput(server.endpoint)}>
                {$t('options.multiplayer.sidekick.useServer', { default: 'Use' })}
              </button>
            {/if}
            <button type="button" class="quiet danger" on:click={() => sidekickSetup.forgetServer(server.endpoint)}>
              {$t('options.multiplayer.sidekick.forgetServer', { default: 'Forget server' })}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <h4>{$t('options.multiplayer.sidekick.recentsTitle', { default: 'Remembered invitations' })}</h4>
    {#if $sidekickRecents.length === 0}
      <p class="hint">{$t('options.multiplayer.sidekick.recentsEmpty', { default: '' })}</p>
    {:else}
      <ul class="recents">
        {#each $sidekickRecents as recent (`${recent.endpoint}::${recent.roomId}`)}
          <li>
            <span class="recent-name">{recent.displayName}</span>
            <span class="mono">{describeEndpoint(recent.endpoint)}</span>
            {#if mode === 'full' && recent.invitationSecret}
              <button
                type="button"
                class="quiet"
                on:click={() => sidekickSetup.captureInvitation({
                  endpoint: recent.endpoint,
                  roomId: recent.roomId,
                  secret: recent.invitationSecret as string,
                  title: recent.displayName
                })}
              >
                {$t('options.multiplayer.sidekick.join', { default: 'Join' })}
              </button>
            {/if}
            <button
              type="button"
              class="quiet danger"
              on:click={() => sidekickSetup.forgetInvitation(recent.endpoint, recent.roomId)}
            >
              {$t('options.multiplayer.sidekick.forgetInvite', { default: 'Forget invitation' })}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .sidekick-setup {
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

  .providers {
    margin: 0;
    padding-left: 1.1rem;
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
