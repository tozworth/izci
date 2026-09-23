<script lang="ts">
  export let title: string;
  export let hint = '';
  export let checkbox = false;
  export let advanced = false;
  export let fieldClass = '';
  export let controlClass = '';
  // Button-only rows render as a div: a wrapping label would turn a title
  // click into a synthetic click on the first button.
  export let useLabel = true;
</script>

<svelte:element
  this={useLabel ? 'label' : 'div'}
  class="field {fieldClass}"
  class:checkbox-field={checkbox}
  class:advanced-tweak={advanced}
>
  <div class="field-copy">
    <span class="field-title">{title}</span>
  </div>
  <div class="field-control {controlClass}" class:checkbox-control={checkbox}>
    <slot></slot>
  </div>
  <p class="field-hint"><slot name="hint">{hint}</slot></p>
</svelte:element>
