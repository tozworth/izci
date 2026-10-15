<script lang="ts">
  import ZoomSettings from '../ZoomSettings.svelte';
  import { t } from 'svelte-i18n';
  import TrayAppearanceSettings from '../TrayAppearanceSettings.svelte';
</script>

<ZoomSettings />

<TrayAppearanceSettings launchOnBootSupported={false} trackInfoBubbleSupported={false}
  showInHint={$t('desktop.appearance.showIn.linuxHint')} />
