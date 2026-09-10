<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import { flyoutResize } from '$lib/services/now-playing-flyout-resize';
  import { nowPlayingState } from '$lib/stores/now-playing-state';
  import { t } from 'svelte-i18n';
  import type { MediaTabKind, WorkspaceTab } from '$lib/types';
  import type { FlyoutSide } from '$lib/stores/now-playing-state';
  import type { WorkspaceTabContentProps, WorkspaceTabDefinition, WorkspaceTabMoveDetail } from './types';
  import WorkspaceTabBar from './WorkspaceTabBar.svelte';
  import WorkspaceTabContent from './WorkspaceTabContent.svelte';
  export let side: FlyoutSide;
  export let tabs: WorkspaceTabDefinition[];
  export let activeWorkspaceTab: WorkspaceTab;
  export let content: WorkspaceTabContentProps;
  export let mediaTheaterActive = false;
  export let mediaKind: MediaTabKind = 'video';
  export let pinned = false;
  export let open = false;
  export let chromeHidden = false;
  const dispatch = createEventDispatcher<{ toggle: void; close: void; pin: void; tabChange: WorkspaceTab; tabClose: WorkspaceTab; tabMove: WorkspaceTabMoveDetail; move: WorkspaceTab; seek: number }>();
  let flyoutElement: HTMLElement | null = null;
  let rememberedTab: WorkspaceTab | null = null;
  $: if (tabs.some(tab => tab.id === activeWorkspaceTab)) rememberedTab = activeWorkspaceTab;
  $: activeTab = tabs.find(tab => tab.id === rememberedTab)?.id ?? tabs[0]?.id ?? null;
  $: visible = (tabs.length > 0 && pinned) || open;
  $: panelsLabel = side === 'left'
    ? $t('workspace.nowPlaying.leftPanels')
    : $t('workspace.nowPlaying.rightPanels');
  $: pinLabel = pinned
    ? $t('workspace.nowPlaying.unpin', { default: 'Unpin panel' })
    : $t('workspace.nowPlaying.pin', { default: 'Pin panel' });

  function handleWindowPointerDown(event: PointerEvent): void {
    if (!open || pinned) return;
    if (event.target instanceof Node && flyoutElement?.contains(event.target)) return;
    dispatch('close');
  }
</script>

<svelte:window on:pointerdown|capture={handleWindowPointerDown} />

<div class="np-flyout-edge" class:right={side === 'right'} class:is-hidden={(chromeHidden && !pinned) || visible}>
  <button type="button" class="np-flyout-handle" aria-expanded={visible}
    aria-controls={`np-flyout-${side}`}
    aria-label={panelsLabel} on:click={() => dispatch('toggle')}>
    <span class="material-symbols-outlined" aria-hidden="true">{side === 'left' ? 'left_panel_open' : 'right_panel_open'}</span>
  </button>
</div>
<aside bind:this={flyoutElement} id={`np-flyout-${side}`} class="np-flyout" class:right={side === 'right'} class:visible class:pinned
  inert={!visible} aria-label={panelsLabel}>
  <div class="np-flyout-toolbar">
    <WorkspaceTabBar {tabs} {activeTab} panelId={side} {mediaKind}
      on:tabChange={(event) => dispatch('tabChange', event.detail)}
      on:tabClose={(event) => dispatch('tabClose', event.detail)}
      on:tabMove={(event) => dispatch('tabMove', event.detail)} />
    <button type="button" class="np-flyout-toolbar-button np-flyout-pin hover-tooltip-anchor"
      aria-pressed={pinned} aria-label={pinLabel} on:click={() => dispatch('pin')}>
      <span class="material-symbols-outlined" aria-hidden="true">push_pin</span>
      <HoverTooltip align="center" nowrap>{pinLabel}</HoverTooltip>
    </button>
    <button type="button" class="np-flyout-toolbar-button hover-tooltip-anchor" disabled={!activeTab}
      aria-label={$t('workspace.nowPlaying.moveSide')} on:click={() => activeTab && dispatch('move', activeTab)}>
      <span class="material-symbols-outlined" aria-hidden="true">{side === 'left' ? 'arrow_forward' : 'arrow_back'}</span>
      <HoverTooltip align="center" nowrap>{$t('workspace.nowPlaying.moveSide')}</HoverTooltip>
    </button>
    <button type="button" class="np-flyout-toolbar-button hover-tooltip-anchor"
      aria-label={$t('workspace.nowPlaying.close', { default: 'Close panel' })} on:click={() => dispatch('close')}>
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
      <HoverTooltip align="right" nowrap>{$t('workspace.nowPlaying.close', { default: 'Close panel' })}</HoverTooltip>
    </button>
  </div>
  <div class="np-flyout-content" role="tabpanel" id={`workspace-tab-panel-${side}-${activeTab}`} aria-labelledby={activeTab ? `workspace-tab-${side}-${activeTab}` : undefined}>
    {#if activeTab}<WorkspaceTabContent tab={activeTab} {content} {mediaTheaterActive} on:seek />{/if}
  </div>
  <!-- Keyboard-operable window splitter; keyboard events are installed by the action. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="np-flyout-resizer" role="separator" aria-orientation="vertical" tabindex="0"
    aria-label={$t('workspace.nowPlaying.resizePanel')} aria-valuemin={220} aria-valuemax={800}
    aria-valuenow={side === 'left' ? $nowPlayingState.leftWidth : $nowPlayingState.rightWidth}
    use:flyoutResize={side}></div>
</aside>
