<script lang="ts">
  import { t } from 'svelte-i18n';
  import TrayAppearanceSettings from '../TrayAppearanceSettings.svelte';
</script>

<TrayAppearanceSettings launchOnBootSupported={false} trackInfoBubbleSupported={false}
  showInHint={$t('desktop.appearance.showIn.linuxHint')} />
