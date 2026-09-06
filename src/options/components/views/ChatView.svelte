<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import { MULTIPLAYER_CHAT_HISTORY_LINES, multiplayerSettings } from '$lib/stores/multiplayer-settings';

  function handleMotdChange(event: Event): void {
    multiplayerSettings.update({
      multiplayerMotd: (event.currentTarget as HTMLInputElement).value
    });
  }

  function handleHistoryChange(event: Event): void {
    multiplayerSettings.update({
      multiplayerChatHistoryLines: MULTIPLAYER_CHAT_HISTORY_LINES[Number((event.currentTarget as HTMLInputElement).value)]
    });
  }

  $: chatHistoryIndex = MULTIPLAYER_CHAT_HISTORY_LINES.indexOf(
    $multiplayerSettings.multiplayerChatHistoryLines as (typeof MULTIPLAYER_CHAT_HISTORY_LINES)[number]
  );
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.multiplayer.chat.category', { default: 'Chat' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.multiplayer.chat.motd.title', { default: 'Message of the day' })}
        hint={$t('options.multiplayer.chat.motd.hint', { default: 'Shown above the chat to guests in sessions hosted by this izci.' })}
      >
        <input
          class="multiplayer-motd-input"
          type="text"
          maxlength="500"
          value={$multiplayerSettings.multiplayerMotd}
          on:change={handleMotdChange}
        />
      </SettingsField>
      <SettingsField
        title={$t('options.multiplayer.chat.history.title', { default: 'Preserve chat history' })}
        hint={$t('options.multiplayer.chat.history.hint', { default: 'Keeps the latest chat lines on this device and restores them when it hosts again.' })}
      >
        <label class="chat-history-control">
          <input
            type="range"
            min="0"
            max={MULTIPLAYER_CHAT_HISTORY_LINES.length - 1}
            step="1"
            value={chatHistoryIndex}
            aria-label={$t('options.multiplayer.chat.history.title', { default: 'Preserve chat history' })}
            on:input={handleHistoryChange}
          />
          <output>{#if $multiplayerSettings.multiplayerChatHistoryLines === 0}{$t('options.multiplayer.chat.history.disabled', { default: 'Disabled' })}{:else}{$t('options.multiplayer.chat.history.lines', { default: '{count} lines', values: { count: $multiplayerSettings.multiplayerChatHistoryLines } })}{/if}</output>
        </label>
      </SettingsField>
    </div>
  </div>
</article>

<style>
  :global(html:not([data-izci-mobile='true'])) input.multiplayer-motd-input {
    width: min(24rem, 50vw);
  }
  .chat-history-control { display: flex; align-items: center; gap: .6rem; }
  .chat-history-control input { width: min(14rem, 35vw); }
  .chat-history-control output { min-width: 5.5rem; }
</style>
