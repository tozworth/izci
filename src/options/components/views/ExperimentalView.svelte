<script lang="ts">
  import { t } from 'svelte-i18n';
</script>

<article class="view">
  <p class="no-experiments">{$t('options.experimental.empty', { default: 'No experiments' })}</p>
</article>

<style>
  .no-experiments {
    margin: 2rem 0;
    color: var(--muted);
    text-align: center;
  }
</style>
