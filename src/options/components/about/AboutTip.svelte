<script lang="ts">
  import { t } from 'svelte-i18n';
  import { nextAboutTip, splitTipEmphasis } from './about-tips';

  const tip = nextAboutTip();

  $: messages = {
    trayVolume: $t('options.about.tips.trayVolume', { default: 'Scroll over the tray icon to change the volume.' }),
    loadouts: $t('options.about.tips.loadouts', { default: 'Loadouts let you take a snapshot of your options and apply them conditionally.' }),
    subsongs: $t('options.about.tips.subsongs', { default: 'Right-click Prev/Next to navigate between subsongs.' }),
    patternChannels: $t('options.about.tips.patternChannels', { default: 'Hover channel headers in the Patterns tab to mute individual channels, or play them solo.' }),
    moduleTools: $t('options.about.tips.moduleTools', { default: 'Editor and Converter both support modules; they are rendered to an audio stream beforehand.' }),
    titleBar: $t('options.about.tips.titleBar', { default: 'On Chromium, after installing izci, click the **Hide title bar** chevron for a sleek, custom title bar.' }),
    mobile: $t('options.about.tips.mobile', { default: 'izci has a mobile UI. Perfect for Multiplayer: host on your PC, join from your phone.' }),
    chameleon: $t('options.about.tips.chameleon', { default: 'Not a fan of the theme selection? The Chameleon theme gives you a custom color and saturation slider.' }),
    restorePlayback: $t('options.about.tips.restorePlayback', { default: '**Playback > Restore playback** lets izci immediately continue blasting the last track it was playing before being closed/refreshed.' }),
    raf: $t('options.about.tips.raf', { default: 'izci includes a simple set of audio effects, from a graphic EQ, to convolution reverb and AGC. Enable **Raf** under Playback.' }),
    advancedTweaks: $t('options.about.tips.advancedTweaks', { default: 'Most option categories include a set of hidden tweaks. Click **Show advanced tweaks** in the top toolbar.' }),
    backups: $t('options.about.tips.backups', { default: 'Back up your settings every once in a while. Backups are also a great way to move between browsers or the Tauri build.' }),
    interpolation: $t('options.about.tips.interpolation', { default: 'izci ships with module interpolation turned off. If mods sound too crispy, enable it under **Modules**.' }),
    experimental: $t('options.about.tips.experimental', { default: 'Check the **Experimental** section, every fiscal year or so.' }),
    multiplayerCache: $t('options.about.tips.multiplayerCache', { default: 'Multiplayer clients cache downloaded tracks to speed up playback and save on data. Configure or disable under **Multiplayer > Cache**.' }),
    contextualTabs: $t('options.about.tips.contextualTabs', { default: 'The Lyrics tab can be set to automatically open if the track contains embedded lyrics; same with the Patterns tab when playing a module. Enable under **Contextual tabs** in **Appearance**.' }),
    name: $t('options.about.tips.name', { default: '"izci" is "scout" in Turkish. It\'s a bad pun on "tracker".' }),
    gruvbox: $t('options.about.tips.gruvbox', { default: 'Gruvbox was the first theme - actually, the *only* theme for a while.' }),
    keygen: $t('options.about.tips.keygen', { default: 'The developer sheds a single tear every time someone refers to modules as "keygen music".' }),
    developmentTime: $t('options.about.tips.developmentTime', { default: 'izci was developed in 37 seconds.' }),
    bugs: $t('options.about.tips.bugs', { default: 'izci contains bugs.' })
  };

  $: segments = splitTipEmphasis(messages[tip.id]);
</script>

<p class="about-tip">
  <span class="about-tip-label">{tip.kind === 'tip'
    ? $t('options.about.tips.tipLabel', { default: 'Tip' })
    : $t('options.about.tips.factLabel', { default: 'Did you know?' })}</span>
  <span class="about-tip-content">{#each segments as segment}{#if segment.emphasis === 'strong'}<strong>{segment.text}</strong>{:else if segment.emphasis === 'em'}<em>{segment.text}</em>{:else}{segment.text}{/if}{/each}</span>
</p>

<style>
  .about-tip {
    position: relative;
    flex: 0 0 auto;
    max-width: 54ch;
    margin: 14px 16px 0;
    color: #b8cbe0;
    font-size: var(--about-small-font-size);
    line-height: 1.5;
  }

  .about-tip-label {
    display: block;
    margin-bottom: 3px;
    color: #edf5ff;
    font-weight: 600;
    text-transform: uppercase;
  }
</style>
