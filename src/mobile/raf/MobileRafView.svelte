<script lang="ts">
  import { tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { MenuActionItem, RafEffectSettings, RafEffectType } from '$lib/types';
  import RafToolbar from '../../options/components/raf/RafToolbar.svelte';
  import RafEffectEditor from '../../options/components/raf/RafEffectEditor.svelte';
  import { reorderEffect } from './raf-reorder';
  import './mobile-raf.css';

  let editingId: string | null = null;
  let list: HTMLElement;
  let backButton: HTMLButtonElement;
  let listScroll = 0;
  let draggedId: string | null = null;
  let dropBoundary: number | null = null;
  let menu: { kind: 'add' | 'effect'; id?: string; x: number; y: number } | null = null;
  let menuDismissedAt = 0;

  function typeName(type: RafEffectType): string {
    switch (type) {
      case 'auto-amp': return $t('options.raf.effectTypes.autoAmp', { default: 'Auto Amp' });
      case 'graphic-eq': return $t('options.raf.effectTypes.graphicEq', { default: 'Graphic EQ' });
      case 'stereo-width': return $t('options.raf.effectTypes.stereoWidth', { default: 'Stereo Width' });
      case 'crystalizer': return $t('options.raf.effectTypes.crystalizer', { default: 'Crystalizer' });
      case 'sloptimizer': return $t('options.raf.effectTypes.sloptimizer', { default: 'Sloptimizer' });
      case 'reverb': return $t('options.raf.effectTypes.reverb', { default: 'Reverb' });
      case 'pitch': return $t('options.raf.effectTypes.pitch', { default: 'Pitch' });
      case 'heat': return $t('options.raf.effectTypes.heat', { default: 'Heat' });
    }
  }

  function toggleEffect(effect: RafEffectSettings) {
    rafSettings.updateEffect(effect.id, (current) => ({ ...current, enabled: !current.enabled }));
  }

  async function editEffect(id: string) {
    listScroll = list?.scrollTop ?? listScroll;
    editingId = id;
    closeMenu();
    await tick();
    backButton?.focus({ preventScroll: true });
  }

  async function backToEffects() {
    const id = editingId;
    editingId = null;
    closeMenu();
    await tick();
    if (list) {
      list.scrollTop = listScroll;
      Array.from(list.querySelectorAll<HTMLButtonElement>('[data-raf-edit]'))
        .find((button) => button.dataset.rafEdit === id)?.focus({ preventScroll: true });
    }
  }

  function closeMenu() {
    menu = null;
    menuDismissedAt = performance.now();
  }

  function openMenu(event: MouseEvent, kind: 'add' | 'effect', id?: string) {
    if (menu || performance.now() - menuDismissedAt < 150) {
      closeMenu();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { kind, id, x: rect.left, y: rect.bottom + 4 };
  }

  function handleAction(action: string) {
    const currentMenu = menu;
    closeMenu();
    if (!currentMenu) return;
    if (currentMenu.kind === 'add') {
      const settings = rafSettings.addEffect(action as RafEffectType);
      const added = settings.effects.at(-1);
      if (added) void editEffect(added.id);
      return;
    }
    const effect = $rafSettings.effects.find((candidate) => candidate.id === currentMenu.id);
    if (!effect) return;
    const index = $rafSettings.effects.indexOf(effect);
    switch (action) {
      case 'edit': void editEffect(effect.id); break;
      case 'rename': {
        const name = window.prompt($t('options.raf.effects.renamePrompt', { default: 'Rename effect (leave blank to use its original name):' }), effect.displayName ?? '');
        if (name !== null) rafSettings.renameEffect(effect.id, name);
        break;
      }
      case 'clone': rafSettings.cloneEffect(effect.id); break;
      case 'delete': rafSettings.removeEffect(effect.id); break;
      case 'up': rafSettings.moveEffect(effect.id, index - 1); break;
      case 'down': rafSettings.moveEffect(effect.id, index + 1); break;
    }
  }

  function previewDrag(id: string | null, boundary: number | null) {
    draggedId = id;
    dropBoundary = boundary;
  }

  $: selectedEffect = $rafSettings.effects.find((effect) => effect.id === editingId) ?? null;
  $: if (editingId && !selectedEffect) void backToEffects();
  $: effectIds = $rafSettings.effects.map((effect) => effect.id);
  $: menuEffectIndex = $rafSettings.effects.findIndex((effect) => effect.id === menu?.id);
  $: menuItems = menu?.kind === 'add'
    ? RAF_EFFECT_DEFINITIONS.map((definition) => ({ id: definition.type, label: typeName(definition.type), icon: definition.icon }))
    : [
      { id: 'edit', label: $t('mobile.raf.edit', { default: 'Edit effect' }), icon: 'tune' },
      { id: 'rename', label: $t('options.raf.effects.rename', { default: 'Rename effect' }), icon: 'edit' },
      { id: 'clone', label: $t('options.raf.effects.clone', { default: 'Clone effect' }), icon: 'content_copy' },
      { id: 'up', label: $t('mobile.raf.moveUp', { default: 'Move up' }), icon: 'arrow_upward', disabled: menuEffectIndex <= 0 },
      { id: 'down', label: $t('mobile.raf.moveDown', { default: 'Move down' }), icon: 'arrow_downward', disabled: menuEffectIndex < 0 || menuEffectIndex === effectIds.length - 1 },
      { id: 'delete', label: $t('options.raf.effects.delete', { default: 'Delete effect' }), icon: 'delete', separatorBefore: true }
    ] satisfies MenuActionItem[];
</script>

<article class="mobile-raf-view">
  {#if selectedEffect}
    <header class="mobile-raf-editor-header">
      <button bind:this={backButton} type="button" aria-label={$t('mobile.raf.back', { default: 'Back to effects' })} on:click={backToEffects}>
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="mobile-raf-heading">
        <strong>{selectedEffect.displayName ?? typeName(selectedEffect.type)}</strong>
        <small>{selectedEffect.displayName ? typeName(selectedEffect.type) : $t('mobile.raf.edit', { default: 'Edit effect' })}</small>
      </div>
      <button type="button" class:active={selectedEffect.enabled} aria-pressed={selectedEffect.enabled} aria-label={selectedEffect.enabled ? $t('options.raf.effects.bypass', { default: 'Bypass effect' }) : $t('options.raf.effects.powerOn', { default: 'Power on effect' })} on:click={() => toggleEffect(selectedEffect)}>
        <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
      </button>
      <button type="button" aria-label={$t('options.raf.effects.reset', { default: 'Reset effect' })} on:click={() => rafSettings.resetEffect(selectedEffect.id)}>
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
      </button>
    </header>
    {#if selectedEffect.type === 'sloptimizer'}
      <div class="mobile-raf-editor-mode" role="group" aria-label={$t('options.raf.effects.sloptimizerMode', { default: 'Sloptimizer editor mode' })}>
        {#each [false, true] as advanced}
          <button type="button" class:active={selectedEffect.advanced === advanced} aria-pressed={selectedEffect.advanced === advanced} on:click={() => rafSettings.updateEffect(selectedEffect.id, (effect) => effect.type === 'sloptimizer' ? { ...effect, advanced } : effect)}>
            {advanced ? $t('options.raf.effects.advanced', { default: 'Advanced' }) : $t('options.raf.effects.simple', { default: 'Simple' })}
          </button>
        {/each}
      </div>
    {/if}
    {#key selectedEffect.id}
      <section class="mobile-raf-editor" class:bypassed={!selectedEffect.enabled} aria-label={selectedEffect.displayName ?? typeName(selectedEffect.type)}>
        <RafEffectEditor effect={selectedEffect} />
      </section>
    {/key}
  {:else}
    <RafToolbar />
    <header class="mobile-raf-list-header">
      <strong>{$t('options.raf.effects.heading', { default: 'Effects' })}</strong>
      <button type="button" on:click={(event) => openMenu(event, 'add')} aria-haspopup="menu" aria-expanded={menu?.kind === 'add'}>
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
        {$t('options.raf.effects.add', { default: 'Add effect' })}
      </button>
    </header>
    <div class="mobile-raf-list" bind:this={list} role="list" aria-label={$t('options.raf.effects.label', { default: 'Raf effects' })}>
      {#each $rafSettings.effects as effect, index (effect.id)}
        <div class="mobile-raf-row" class:dragging={draggedId === effect.id} class:drop-before={draggedId !== null && dropBoundary === index} data-raf-effect-row role="listitem">
          <button type="button" class="mobile-raf-drag" use:reorderEffect={{ id: effect.id, list, ids: effectIds, preview: previewDrag, move: rafSettings.moveEffect }} aria-label={$t('options.raf.effects.dragToReorder', { default: 'Drag {effect} to reorder', values: { effect: effect.displayName ?? typeName(effect.type) } })}>
            <span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span>
          </button>
          <button type="button" class="mobile-raf-effect" class:bypassed={!effect.enabled} data-raf-edit={effect.id} on:click={() => editEffect(effect.id)}>
            <span class="material-symbols-outlined mobile-raf-icon" aria-hidden="true">{RAF_EFFECT_REGISTRY[effect.type].icon}</span>
            <span class="mobile-raf-heading">
              <strong>{effect.displayName ?? typeName(effect.type)}</strong>
              {#if effect.displayName}<small>{typeName(effect.type)}</small>{/if}
            </span>
            <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" class:active={effect.enabled} aria-pressed={effect.enabled} aria-label={effect.enabled ? $t('options.raf.effects.bypass', { default: 'Bypass effect' }) : $t('options.raf.effects.powerOn', { default: 'Power on effect' })} on:click={() => toggleEffect(effect)}>
            <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
          </button>
          <button type="button" aria-label={$t('options.raf.effects.actions', { default: 'Effect actions' })} aria-haspopup="menu" aria-expanded={menu?.id === effect.id} on:click={(event) => openMenu(event, 'effect', effect.id)}>
            <span class="material-symbols-outlined" aria-hidden="true">more_vert</span>
          </button>
        </div>
      {/each}
      <div class="mobile-raf-drop-tail" class:drop-before={draggedId !== null && dropBoundary === effectIds.length} aria-hidden="true"></div>
      {#if !effectIds.length}
        <p class="mobile-raf-empty">{$t('options.raf.effects.empty', { default: 'Add an effect to start building the rack' })}</p>
      {/if}
    </div>
  {/if}
</article>

{#if menu}
  <MenuSurface items={menuItems} x={menu.x} y={menu.y} ariaLabel={menu.kind === 'add' ? $t('options.raf.effects.add', { default: 'Add effect' }) : $t('options.raf.effects.actions', { default: 'Effect actions' })} on:action={(event) => handleAction(event.detail)} on:dismiss={closeMenu} />
{/if}
