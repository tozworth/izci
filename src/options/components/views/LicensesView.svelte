<script lang="ts">
  import { t } from 'svelte-i18n';
  import licenseText from '../../../../LICENSE.md?raw';
  import thirdPartyNotices from '../../../../THIRD-PARTY-NOTICES.md?raw';
</script>

<article class="view license-view">
  <pre class="license-document" aria-label={$t('options.licenses.documentLabel', { default: 'izci license and third-party notices' })}>{licenseText + '\n\n' + thirdPartyNotices}</pre>
</article>
