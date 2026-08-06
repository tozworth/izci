<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import SelectDropdown, {
    type SelectDropdownOption
  } from '$lib/components/SelectDropdown.svelte';

  export let value: string;
  export let options: SelectDropdownOption[] = [];
  export let label: string;

  const dispatch = createEventDispatcher<{ change: string }>();
</script>

<SelectDropdown
  {value}
  {options}
  {label}
  block
  on:change={(event) => dispatch('change', event.detail)}
/>
