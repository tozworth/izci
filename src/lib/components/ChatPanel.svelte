<script lang="ts">
  import { afterUpdate } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { Readable } from 'svelte/store';
  import type {
    MultiplayerChatMessage,
    MultiplayerChatTrackLink
  } from '$lib/services/multiplayer-protocol';
  import { parseMultiplayerChatCommand } from '$lib/services/multiplayer-chat';

  export let messages: Readable<MultiplayerChatMessage[]>;
  export let motd = '';
  export let motdHostName: string | null = null;
  export let sendMessage: (text: string) => boolean;
  export let sendNowPlaying: (track: MultiplayerChatTrackLink) => boolean = () => false;
  export let nowPlayingTrack: MultiplayerChatTrackLink | null = null;
  export let activateTrack: (track: MultiplayerChatTrackLink) => void = () => undefined;
  export let connected = false;

  let input = '';
  let messageList: HTMLDivElement;

  function submit(): void {
    if (!connected) return;
    const command = parseMultiplayerChatCommand(input);
    const sent = command?.action === 'now-playing'
      ? Boolean(nowPlayingTrack && sendNowPlaying(nowPlayingTrack))
      : sendMessage(input);
    if (!sent) return;
    input = '';
  }

  function formatTimestamp(sentAt: number): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(sentAt);
  }

  afterUpdate(() => {
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  });
</script>

<section class="chat-panel" aria-label={$t('main.multiplayer.chatLabel', { default: 'Multiplayer chat' })}>
  <div class="chat-messages" bind:this={messageList} role="log" aria-live="polite" aria-relevant="additions">
    {#if motd && motdHostName}
      <div class="chat-motd">
        <div class="chat-motd-header">
          {$t('main.multiplayer.chatMotd', {
            default: 'MOTD - {hostName}',
            values: { hostName: motdHostName }
          })}
        </div>
        <div class="chat-motd-text">{motd}</div>
      </div>
    {/if}
    {#if $messages.length === 0}
      <p class="chat-empty">{$t('main.multiplayer.chatEmpty', { default: 'No messages yet.' })}</p>
    {:else}
      {#each $messages as message (message.id)}
        <div
          class="chat-line"
          class:chat-action={message.action === 'me'}
          class:chat-notice={message.action === 'join' || message.action === 'leave'}
        >
          {#if message.action === 'now-playing' && message.track}
            <span class="chat-name">{message.name}</span>
            <span class="chat-text">{$t('main.multiplayer.chatNowPlaying', { default: 'is listening to' })}</span>
            <button
              class="chat-track-link"
              type="button"
              aria-label={$t('main.multiplayer.chatPlayTrack', {
                default: 'Play {title}',
                values: { title: message.track.title }
              })}
              title={$t('main.multiplayer.chatPlayTrack', {
                default: 'Play {title}',
                values: { title: message.track.title }
              })}
              on:click={() => activateTrack(message.track!)}
            >
              <span class="material-symbols-outlined" aria-hidden="true">music_note</span>
              <span class="chat-track-title">{message.track.title}</span>
            </button>
          {:else if message.action === 'me'}
            <span class="chat-action-prefix" aria-hidden="true">*</span>
            <span class="chat-name">{message.name}</span>
            <span class="chat-text">{message.text}</span>
          {:else if message.action === 'join'}
            <span class="material-symbols-outlined chat-notice-icon" aria-hidden="true">
              login
            </span>
            <span class="chat-notice-text">
              {$t('main.multiplayer.chatJoined', {
                default: '{name} joined',
                values: { name: message.name }
              })}
            </span>
          {:else if message.action === 'leave'}
            <span class="material-symbols-outlined chat-notice-icon" aria-hidden="true">
              logout
            </span>
            <span class="chat-notice-text">
              {$t('main.multiplayer.chatLeft', {
                default: '{name} left',
                values: { name: message.name }
              })}
            </span>
          {:else}
            <span class="chat-name">{message.name}</span>
            <span class="chat-colon" aria-hidden="true">:</span>
            {#if message.track}
              <button
                class="chat-track-link"
                type="button"
                aria-label={$t('main.multiplayer.chatPlayTrack', {
                  default: 'Play {title}',
                  values: { title: message.track.title }
                })}
                title={$t('main.multiplayer.chatPlayTrack', {
                  default: 'Play {title}',
                  values: { title: message.track.title }
                })}
                on:click={() => activateTrack(message.track!)}
              >
                <span class="material-symbols-outlined" aria-hidden="true">music_note</span>
                <span class="chat-track-title">{message.track.title}</span>
              </button>
            {:else}
              <span class="chat-text">{message.text}</span>
            {/if}
          {/if}
          <time class="chat-time" datetime={new Date(message.sentAt).toISOString()}>{formatTimestamp(message.sentAt)}</time>
        </div>
      {/each}
    {/if}
  </div>

  <form class="chat-compose" on:submit|preventDefault={submit}>
    <input
      bind:value={input}
      type="text"
      maxlength="500"
      autocomplete="off"
      disabled={!connected}
      placeholder={$t('main.multiplayer.chatPlaceholder', { default: 'Message' })}
      aria-label={$t('main.multiplayer.chatInput', { default: 'Chat message' })}
    />
    <button
      type="submit"
      disabled={!connected || input.trim().length === 0}
      aria-label={$t('main.multiplayer.chatSend', { default: 'Send' })}
      title={$t('main.multiplayer.chatSend', { default: 'Send' })}
    >
      <span class="material-symbols-outlined" aria-hidden="true">send</span>
    </button>
  </form>
</section>

<style>
  .chat-panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--surface-color, transparent);
  }

  .chat-messages {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 10px;
    font-size: 0.88rem;
    line-height: 1.35;
  }

  .chat-line {
    display: flex;
    align-items: baseline;
    gap: 0.28rem;
    min-width: 0;
    padding: 2px 0;
  }

  .chat-action {
    color: color-mix(in srgb, currentColor 62%, transparent);
    font-style: italic;
  }

  .chat-notice {
    color: color-mix(in srgb, currentColor 62%, transparent);
  }

  .chat-action .chat-name {
    color: inherit;
    font-weight: 500;
  }

  .chat-action-prefix {
    flex: 0 0 auto;
  }

  .chat-notice-icon {
    flex: 0 0 auto;
    font-size: 1rem;
  }

  .chat-notice-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .chat-name {
    flex: 0 0 auto;
    color: var(--accent-strong, currentColor);
    font-weight: 600;
  }

  .chat-colon {
    flex: 0 0 auto;
    opacity: 0.55;
  }

  .chat-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .chat-track-link {
    display: inline-flex;
    align-items: baseline;
    min-width: 0;
    gap: 0.18rem;
    padding: 0;
    border: 0;
    color: var(--accent, currentColor);
    background: transparent;
    font: inherit;
    text-align: left;
  }

  .chat-track-link:focus-visible {
    outline: 1px solid var(--accent-focus-border, currentColor);
    outline-offset: 1px;
  }

  .chat-track-link .material-symbols-outlined {
    flex: 0 0 auto;
    font-size: 1rem;
  }

  .chat-track-title {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .chat-time {
    flex: 0 0 auto;
    margin-left: auto;
    padding-left: 0.6rem;
    color: color-mix(in srgb, currentColor 62%, transparent);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .chat-empty {
    margin: 0;
    color: color-mix(in srgb, currentColor 65%, transparent);
  }

  .chat-motd {
    margin: 0 0 0.6rem;
    padding: 0 0 0.55rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  }

  .chat-motd-header {
    margin-bottom: 0.16rem;
    color: color-mix(in srgb, currentColor 62%, transparent);
    font-size: 0.78rem;
    font-weight: 600;
  }

  .chat-motd-text {
    overflow-wrap: anywhere;
  }

  .chat-compose {
    display: flex;
    gap: 6px;
    padding: 7px 8px;
    border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  }

  .chat-compose input {
    min-width: 0;
    flex: 1;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    outline: none;
    appearance: none;
  }

  .chat-compose input:focus-visible {
    outline: 1px solid var(--accent-focus-border, color-mix(in srgb, var(--accent-strong, currentColor) 48%, transparent));
    outline-offset: -1px;
  }

  .chat-compose button {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent-strong, currentColor);
  }

  .chat-compose button .material-symbols-outlined {
    font-size: 1.15rem;
  }

  .chat-compose button:disabled {
    color: color-mix(in srgb, currentColor 38%, transparent);
  }

  @media (max-width: 520px) {
    .chat-time {
      display: none;
    }
  }
</style>
