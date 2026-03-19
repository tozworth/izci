<script lang="ts">
  export let label: string;
  export let width = 14;
  export let onPointerDown: (event: PointerEvent) => void = () => {};
</script>

<div
  class="workspace-resizer"
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  style={`width: ${width}px;`}
  on:pointerdown={onPointerDown}
>
  <span class="workspace-resizer-handle" aria-hidden="true"></span>
</div>
