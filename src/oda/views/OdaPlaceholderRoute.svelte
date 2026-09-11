<script lang="ts">
  import type { OdaTranslate } from '../oda-translate';

  export let title: string;
  export let message = '';
  export let translate: OdaTranslate;
</script>

<div class="oda-placeholder">
  <h2>{title}</h2>
  <p>{message || translate('oda.placeholder.default', 'This Oda screen is not available yet.')}</p>
  <p class="oda-placeholder-hint">{translate('oda.placeholder.back', 'Press Back or Escape to return.')}</p>
</div>
