<script lang="ts">
  import { onMount } from 'svelte';
  import { locale } from 'svelte-i18n';
  import { formatOdaClockText } from './oda-clock';

  let now = new Date();
  let timer = 0;

  onMount(() => {
    timer = window.setInterval(() => {
      now = new Date();
    }, 1000);
    return () => window.clearInterval(timer);
  });

  $: clock = formatOdaClockText(
    now,
    $locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en') ?? 'en'
  );
</script>

<!--
  Presentational ten-foot chrome: brand glyph top-left, date/time top-right.
  aria-hidden so the ticking clock never spams screen readers, and
  pointer-events none (see oda.css) so remote focus never lands here.
-->
<div class="oda-top-chrome" aria-hidden="true">
  <span class="oda-top-glyph"></span>
  <span class="oda-top-clock"><span class="oda-top-date">{clock.date}</span> <strong>{clock.time}</strong></span>
</div>
