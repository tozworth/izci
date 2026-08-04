<script lang="ts">
  export let size = '0.9rem';
  export let label = 'izci multiplayer';
</script>

<span class="multiplayer-mark" style={`--multiplayer-mark-size: ${size};`} role="img" aria-label={label}>
  <span class="fork fork-top" aria-hidden="true">izci</span>
  <span class="center" aria-hidden="true">izci</span>
  <span class="fork fork-bottom" aria-hidden="true">izci</span>
</span>

<style>
  .multiplayer-mark {
    display: grid;
    grid-template-columns: 3ch 4ch;
    grid-template-rows: repeat(3, 1em);
    width: 7ch;
    color: var(--text-strong);
    font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
    font-size: var(--multiplayer-mark-size);
    font-weight: 650;
    line-height: 1;
    letter-spacing: 0;
    white-space: nowrap;
  }

  .multiplayer-mark span {
    display: block;
  }

  .center {
    grid-column: 1 / span 2;
    grid-row: 2;
    color: var(--text-strong);
  }

  .fork {
    grid-column: 2;
    color: var(--muted);
    font-weight: 500;
    opacity: 0.72;
  }

  .fork-top {
    grid-row: 1;
  }

  .fork-bottom {
    grid-row: 3;
  }
</style>
