<script lang="ts">
  import RafToolbar from './RafToolbar.svelte';
  import RafEffectsWorkspace from './RafEffectsWorkspace.svelte';
</script>

<article class="raf-view">
  <RafToolbar />
  <RafEffectsWorkspace />
</article>

<style>
  .raf-view { width: 100%; height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
</style>
