<script module lang="ts">
  import { defineMessages } from 'svelte-i18n';

  // Build-time and service-owned messages are declared here so the standard
  // svelte-i18n extractor includes them in the Crowdin source catalog.
  export const nonComponentMessages = defineMessages({
    pwaDescription: {
      id: 'pwa.description',
      default: 'Offline-first PWA music player with tracker module support.'
    }
  });
</script>
