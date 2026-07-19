<script lang="ts">
  import { t } from 'svelte-i18n';
  import licenseText from '../../../../LICENSE.md?raw';
</script>

<article class="view license-view">
  <pre class="license-document" aria-label={$t('options.licenses.documentLabel', { default: 'izci license and third-party notices' })}>{licenseText}</pre>
</article>
