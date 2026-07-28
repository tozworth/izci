<script lang="ts">
  export let title: string;
  export let hint = '';
  export let checkbox = false;
  export let advanced = false;
  export let fieldClass = '';
  export let controlClass = '';
</script>

<label class="field {fieldClass}" class:checkbox-field={checkbox} class:advanced-tweak={advanced}>
  <div class="field-copy">
    <span class="field-title">{title}</span>
  </div>
  <div class="field-control {controlClass}" class:checkbox-control={checkbox}>
    <slot></slot>
  </div>
  <p class="field-hint"><slot name="hint">{hint}</slot></p>
</label>
