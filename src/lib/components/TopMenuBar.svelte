<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { fade } from 'svelte/transition';
  import { t } from 'svelte-i18n';
  import { version as appVersion } from '../../../package.json';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { applyManualLoadoutSettings } from '$lib/services/loadouts';
  import { pwaUpdateStatus, type PwaUpdateStatus } from '$lib/services/pwa-updates';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { loadouts } from '$lib/stores/loadouts';
  import type { MenuActionItem, VideoFitMode } from '$lib/types';
  import { getLoadoutColorValue, LOADOUT_TYPE_ICONS } from '$lib/utils/loadout-presentation';
  import { formatDisplayVersion } from '$lib/utils/version';
  import type { OptionsViewName } from '../../options/views';

  type MenuId = 'app' | 'file' | 'view' | 'video' | 'help';
  type DispatchedMenuActionId =
    | 'openFiles'
    | 'openFolder'
    | 'installApp'
    | 'openOptions'
    | 'forceUpdate'
    | 'openAbout'
    | 'openAudioCompare'
    | 'openEditor'
    | 'openConverter'
    | 'openTroubadour'
    | 'showPlaylist'
    | 'showLibrary'
    | 'showTrackDetails'
    | 'showLyrics'
    | 'togglePatterns'
    | 'toggleMiniPlayer'
    | 'toggleNowPlayingView'
    | 'exit';
  type MenuActionId =
    | DispatchedMenuActionId
    | 'openLoadouts'
    | 'videoFitContain'
    | 'videoFitCover'
    | 'toggleVideoPictureInPicture'
    | 'toggleVideoTheater'
    | `applyLoadout:${string}`;

  const MENU_ITEMS_ONLY_PADDING = 28;
  const MENU_ITEMS_WITH_VERSION_PADDING = 40;
  const FALLBACK_MENU_GROUPS_WIDTH = 140;
  const FALLBACK_MENU_BRAND_WIDTH = 88;

  $: loadoutMenuItems = [
    {
      id: 'openLoadouts',
      label: $t('main.menu.openLoadouts', { default: 'Open loadouts' }),
      icon: 'bookmark_manager'
    },
    ...$loadouts.loadouts.map((loadout, index) => ({
      id: `applyLoadout:${loadout.id}`,
      label: loadout.name,
      icon: LOADOUT_TYPE_ICONS[loadout.target.type],
      iconColor: getLoadoutColorValue(loadout.color),
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
  $: appMenuItems = [
    ...(installAvailable
      ? [{
          id: 'installApp',
          label: $t('main.menu.installApp', { default: 'Install izci...' }),
          description: showInstallHint || installHintPresentedInOpenMenu
            ? $t('main.menu.installDescription', {
                default: 'Install the PWA to get file associations, a compact title bar, better OS integration and automatic updates.'
              })
            : undefined,
          icon: 'install_desktop',
          attention: showInstallHint || installHintPresentedInOpenMenu
        } satisfies MenuActionItem]
      : []),
    {
      id: 'openOptions',
      label: $t('main.menu.options', { default: 'Options...' }),
      icon: 'settings',
      shortcut: 'Ctrl+P',
      separatorBefore: installAvailable
    },
    {
      id: 'loadouts',
      label: $t('main.menu.loadouts', { default: 'Loadouts' }),
      icon: 'bookmarks',
      children: loadoutMenuItems
    },
    {
      id: 'openTroubadour',
      label: $t('main.menu.troubadour', { default: 'Troubadour...' }),
      icon: 'library_music',
      separatorBefore: true
    },
    {
      id: 'openAudioCompare',
      label: $t('main.menu.audioCompare', { default: 'Audio Compare...' }),
      icon: 'compare_arrows'
    },
    {
      id: 'openEditor',
      label: $t('main.menu.editor', { default: 'Editor...' }),
      icon: 'content_cut'
    },
    {
      id: 'openConverter',
      label: $t('main.menu.converter', { default: 'Converter...' }),
      icon: 'sync_alt'
    },
    {
      id: 'openAbout',
      label: $t('main.menu.about', { default: 'About' }),
      icon: 'info',
      separatorBefore: true
    },
    {
      id: 'exit',
      label: $t('main.menu.exit', { default: 'Exit' }),
      icon: 'logout',
      shortcut: 'Ctrl+Q'
    }
  ] satisfies MenuActionItem[];
  $: fileMenuItems = [
    {
      id: 'openFiles',
      label: $t('main.menu.openFiles', { default: 'Open files...' }),
      icon: 'file_open',
      shortcut: 'Ctrl+O'
    },
    {
      id: 'openFolder',
      label: $t('main.menu.openFolder', { default: 'Open folder...' }),
      icon: 'folder_open'
    }
  ] satisfies MenuActionItem[];
  $: helpMenuItems = [
    {
      id: 'forceUpdate',
      label: $t('main.menu.forceUpdate', { default: 'Force update' }),
      icon: 'sync'
    }
  ] satisfies MenuActionItem[];

  export let nowPlayingViewActive = false;
  export let miniPlayerSupported = false;
  export let miniPlayerActive = false;
  export let patternsVisible = false;
  export let videoActive = false;
  export let videoFitMode: VideoFitMode = 'contain';
  export let videoPictureInPictureSupported = false;
  export let videoTheaterActive = false;
  export let installAvailable = false;
  export let showInstallHint = false;
  export let height = 0;
  const displayVersion = formatDisplayVersion(appVersion);

  const dispatch = createEventDispatcher<{
    openFiles: void;
    openFolder: void;
    installApp: void;
    acknowledgeInstallHint: void;
    openOptions: { view?: OptionsViewName } | undefined;
    forceUpdate: void;
    openAbout: void;
    openAudioCompare: void;
    openEditor: void;
    openConverter: void;
    openTroubadour: void;
    showPlaylist: void;
    showLibrary: void;
    showTrackDetails: void;
    showLyrics: void;
    togglePatterns: void;
    toggleMiniPlayer: void;
    toggleNowPlayingView: void;
    setVideoFit: VideoFitMode;
    toggleVideoPictureInPicture: void;
    toggleVideoTheater: void;
    exit: void;
  }>();

  let activeMenu: MenuId | null = null;
  let compactMenuOpen = false;
  let compactMenuX = 8;
  let compactMenuY = 8;
  let menuPopupX = 8;
  let menuPopupY = 8;
  let menuBarElement: HTMLElement | null = null;
  let compactMenuTriggerElement: HTMLButtonElement | null = null;
  let appMenuTriggerElement: HTMLButtonElement | null = null;
  let fileMenuTriggerElement: HTMLButtonElement | null = null;
  let viewMenuTriggerElement: HTMLButtonElement | null = null;
  let videoMenuTriggerElement: HTMLButtonElement | null = null;
  let helpMenuTriggerElement: HTMLButtonElement | null = null;
  let menuBarWidth = Number.POSITIVE_INFINITY;
  let availableTitlebarWidth = Number.POSITIVE_INFINITY;
  let menuGroupsWidth = 0;
  let menuBrandWidth = 0;
  let menubarPressPointerId: number | null = null;
  let suppressNextRootClick = false;
  let installHintPresentedInOpenMenu = false;
  let displayedUpdateStatus: PwaUpdateStatus = get(pwaUpdateStatus);
  let pendingUpdateStatus = displayedUpdateStatus;
  let updateIndicatorVisible = true;

  $: if ($pwaUpdateStatus !== pendingUpdateStatus) {
    pendingUpdateStatus = $pwaUpdateStatus;
    updateIndicatorVisible = false;
  }

  function handleUpdateIndicatorOutroEnd() {
    displayedUpdateStatus = pendingUpdateStatus;
    updateIndicatorVisible = true;
  }

  $: viewMenuItems = [
    {
      id: 'showPlaylist',
      label: $t('main.menu.playlist', { default: 'Playlist' }),
      icon: 'queue_music'
    },
    {
      id: 'showLibrary',
      label: $t('main.menu.library', { default: 'Library' }),
      icon: 'library_music'
    },
    {
      id: 'showTrackDetails',
      label: $t('main.menu.trackDetails', { default: 'Track Details' }),
      icon: 'info'
    },
    {
      id: 'showLyrics',
      label: $t('main.menu.lyrics', { default: 'Lyrics' }),
      icon: 'lyrics'
    },
    {
      id: 'togglePatterns',
      label: $t('main.menu.patterns', { default: 'Patterns' }),
      icon: patternsVisible ? 'check' : 'view_timeline'
    },
    ...(miniPlayerSupported
      ? [{
          id: 'toggleMiniPlayer',
          label: $t('main.menu.miniPlayer', { default: 'Mini player' }),
          icon: miniPlayerActive ? 'check' : 'picture_in_picture_alt',
          shortcut: 'Ctrl+M',
          separatorBefore: true
        } satisfies MenuActionItem]
      : []),
    {
      id: 'toggleNowPlayingView',
      label: $t('main.menu.nowPlaying', { default: 'Now Playing' }),
      icon: nowPlayingViewActive ? 'check' : 'album'
    }
  ] satisfies MenuActionItem[];
  $: videoMenuItems = [
    {
      id: 'videoFitContain',
      label: $t('main.video.fit', { default: 'Fit to window' }),
      icon: videoFitMode === 'contain' ? 'check' : 'fit_screen'
    },
    {
      id: 'videoFitCover',
      label: $t('main.video.fill', { default: 'Fill window' }),
      icon: videoFitMode === 'cover' ? 'check' : 'crop_free'
    },
    ...(videoPictureInPictureSupported
      ? [{
          id: 'toggleVideoPictureInPicture',
          label: $t('main.video.pictureInPicture', { default: 'Picture in Picture' }),
          icon: 'picture_in_picture_alt',
          separatorBefore: true
        } satisfies MenuActionItem]
      : []),
    {
      id: 'toggleVideoTheater',
      label: videoTheaterActive
        ? $t('main.player.exitVideoTheater', { default: 'Exit video theater' })
        : $t('main.player.enterVideoTheater', { default: 'Enter video theater' }),
      icon: videoTheaterActive ? 'check' : 'fit_screen',
      separatorBefore: !videoPictureInPictureSupported
    }
  ] satisfies MenuActionItem[];
  $: compactMenuItems = [
    ...appMenuItems,
    {
      id: 'file',
      label: $t('main.menu.file', { default: 'File' }),
      icon: 'folder',
      separatorBefore: true,
      children: fileMenuItems
    },
    {
      id: 'view',
      label: $t('main.menu.view', { default: 'View' }),
      icon: 'visibility',
      children: viewMenuItems
    },
    ...(videoActive
      ? [{
          id: 'video',
          label: $t('main.video.menu', { default: 'Video' }),
          icon: 'movie',
          children: videoMenuItems
        } satisfies MenuActionItem]
      : []),
    {
      id: 'help',
      label: $t('main.menu.help', { default: 'Help' }),
      icon: 'help',
      children: helpMenuItems
    }
  ] satisfies MenuActionItem[];

  $: overlayState = $windowControlsOverlayState;
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';
  $: availableTitlebarWidth = overlayState.visible
    ? Math.max(0, overlayRect.width)
    : menuBarWidth;
  $: resolvedMenuGroupsWidth = menuGroupsWidth || FALLBACK_MENU_GROUPS_WIDTH;
  $: resolvedMenuBrandWidth = menuBrandWidth || FALLBACK_MENU_BRAND_WIDTH;
  $: showVersionIndicator = !overlayState.visible
    || availableTitlebarWidth >= resolvedMenuGroupsWidth + resolvedMenuBrandWidth + MENU_ITEMS_WITH_VERSION_PADDING;
  $: compactMenuThreshold = overlayState.visible
    ? resolvedMenuGroupsWidth + MENU_ITEMS_ONLY_PADDING
    : resolvedMenuGroupsWidth + resolvedMenuBrandWidth + MENU_ITEMS_WITH_VERSION_PADDING;
  $: isCompactMenu = availableTitlebarWidth < compactMenuThreshold;
  $: if (isCompactMenu) {
    activeMenu = null;
  } else {
    compactMenuOpen = false;
  }
  $: if (!videoActive && activeMenu === 'video') {
    activeMenu = null;
  }
  $: if (activeMenu !== null) {
    updateMenuPosition(activeMenu);
  }

  function toggleMenu(menuId: MenuId) {
    compactMenuOpen = false;
    menubarPressPointerId = null;
    const nextMenu = activeMenu === menuId ? null : menuId;
    activeMenu = nextMenu;

    if (nextMenu === 'app' && showInstallHint) {
      installHintPresentedInOpenMenu = true;
      dispatch('acknowledgeInstallHint');
    } else if (nextMenu !== 'app') {
      installHintPresentedInOpenMenu = false;
    }

    if (nextMenu !== null) {
      updateMenuPosition(nextMenu);
    }
  }

  function closeMenus() {
    activeMenu = null;
    compactMenuOpen = false;
    installHintPresentedInOpenMenu = false;
    menubarPressPointerId = null;
    suppressNextRootClick = false;
  }

  function handleMenuHover(menuId: MenuId) {
    if (isCompactMenu) {
      return;
    }

    if (activeMenu !== null && activeMenu !== menuId) {
      activeMenu = menuId;
      updateMenuPosition(menuId);
    }
  }

  function handleRootPointerDown(event: PointerEvent, menuId: MenuId) {
    if (isCompactMenu || event.button !== 0) {
      return;
    }

    event.preventDefault();
    compactMenuOpen = false;
    activeMenu = menuId;
    if (menuId === 'app' && showInstallHint) {
      installHintPresentedInOpenMenu = true;
      dispatch('acknowledgeInstallHint');
    } else if (menuId !== 'app') {
      installHintPresentedInOpenMenu = false;
    }
    menubarPressPointerId = event.pointerId;
    suppressNextRootClick = true;
    updateMenuPosition(menuId);
  }

  function handleRootClick(menuId: MenuId) {
    if (suppressNextRootClick) {
      suppressNextRootClick = false;
      return;
    }

    toggleMenu(menuId);
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!menuBarElement || (activeMenu === null && !compactMenuOpen)) {
      return;
    }

    const target = event.target;

    if (!(target instanceof Element)) {
      closeMenus();
      return;
    }

    if (target.closest('[data-menu-interactive="true"]')) {
      return;
    }

    closeMenus();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeMenus();
    }
  }

  function handleWindowPointerUp(event: PointerEvent) {
    if (menubarPressPointerId === event.pointerId) {
      menubarPressPointerId = null;
      window.setTimeout(() => {
        suppressNextRootClick = false;
      }, 0);
    }
  }

  function runMenuAction(action: MenuActionId) {
    closeMenus();
    if (action === 'openLoadouts') {
      dispatch('openOptions', { view: 'loadouts' });
      return;
    }
    if (action.startsWith('applyLoadout:')) {
      const loadoutId = action.slice('applyLoadout:'.length);
      const loadout = loadouts.getSnapshot().loadouts.find((candidate) => candidate.id === loadoutId);
      if (loadout) {
        applyManualLoadoutSettings(loadout.settings);
      }
      return;
    }
    if (action === 'videoFitContain' || action === 'videoFitCover') {
      dispatch('setVideoFit', action === 'videoFitContain' ? 'contain' : 'cover');
      return;
    }
    if (action === 'toggleVideoPictureInPicture') {
      dispatch('toggleVideoPictureInPicture');
      return;
    }
    if (action === 'toggleVideoTheater') {
      dispatch('toggleVideoTheater');
      return;
    }
    dispatch(action as DispatchedMenuActionId);
  }

  function getMenuTriggerElement(menuId: MenuId) {
    if (menuId === 'app') {
      return appMenuTriggerElement;
    }

    if (menuId === 'file') {
      return fileMenuTriggerElement;
    }

    if (menuId === 'view') {
      return viewMenuTriggerElement;
    }

    return menuId === 'video' ? videoMenuTriggerElement : helpMenuTriggerElement;
  }

  function updateMenuPosition(menuId: MenuId) {
    const triggerElement = getMenuTriggerElement(menuId);

    if (!triggerElement) {
      return;
    }

    const rect = triggerElement.getBoundingClientRect();
    menuPopupX = rect.left;
    menuPopupY = rect.bottom + 6;
  }

  function toggleCompactMenu() {
    if (!compactMenuTriggerElement) {
      compactMenuOpen = !compactMenuOpen;
      return;
    }

    const nextOpen = !compactMenuOpen;
    compactMenuOpen = nextOpen;
    activeMenu = null;

    if (nextOpen && showInstallHint) {
      installHintPresentedInOpenMenu = true;
      dispatch('acknowledgeInstallHint');
    } else if (!nextOpen) {
      installHintPresentedInOpenMenu = false;
    }

    if (!nextOpen) {
      return;
    }

    const rect = compactMenuTriggerElement.getBoundingClientRect();
    compactMenuX = rect.left;
    compactMenuY = rect.bottom + 6;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('keydown', handleWindowKeydown);
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('keydown', handleWindowKeydown);
    }

  });
</script>

<nav
  bind:this={menuBarElement}
  bind:clientWidth={menuBarWidth}
  bind:clientHeight={height}
  class="menu-bar"
  class:window-controls-overlay-active={overlayState.visible}
  class:menu-bar-compact={isCompactMenu}
  style={overlayInlineStyle}
  aria-label={$t('main.menu.applicationMenu', { default: 'Application menu' })}
>
  {#if isCompactMenu}
    <button
      bind:this={compactMenuTriggerElement}
      class="menu-trigger compact-menu-trigger"
      class:install-hint-visible={showInstallHint}
      data-menu-interactive="true"
      type="button"
      aria-haspopup="menu"
      aria-expanded={compactMenuOpen}
      on:click={toggleCompactMenu}
    >
      <span class="izci-menu-glyph" aria-hidden="true"></span>
      <span class="sr-only">{$t('main.menu.applicationMenu', { default: 'Application menu' })}</span>
      <span class="material-symbols-outlined compact-menu-chevron" aria-hidden="true">
        {compactMenuOpen ? 'expand_less' : 'expand_more'}
      </span>
    </button>

    {#if compactMenuOpen}
      <MenuSurface
        items={compactMenuItems}
        x={compactMenuX}
        y={compactMenuY}
        ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
        enableOverflowSubmenuFallback={true}
        on:action={(event) => runMenuAction(event.detail as MenuActionId)}
        on:dismiss={closeMenus}
      />
    {/if}
  {:else}
    <div class="menu-groups" bind:clientWidth={menuGroupsWidth}>
      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('app')}>
        <button
          bind:this={appMenuTriggerElement}
          class:active={activeMenu === 'app'}
          class="menu-trigger app-menu-trigger"
          class:install-hint-visible={showInstallHint}
          data-menu-interactive="true"
          type="button"
          aria-label={$t('main.menu.applicationMenu', { default: 'Application menu' })}
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'app'}
          on:pointerdown={(event) => handleRootPointerDown(event, 'app')}
          on:click={() => handleRootClick('app')}
        >
          <span class="izci-menu-glyph" aria-hidden="true"></span>
        </button>
        {#if activeMenu === 'app'}
          <MenuSurface
            items={appMenuItems}
            x={menuPopupX}
            y={menuPopupY}
            ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
            activateOnPointerUpPointerId={menubarPressPointerId}
            on:action={(event) => runMenuAction(event.detail as MenuActionId)}
            on:dismiss={closeMenus}
          />
        {/if}
      </div>

      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('file')}>
        <button
          bind:this={fileMenuTriggerElement}
          class:active={activeMenu === 'file'}
          class="menu-trigger"
          data-menu-interactive="true"
          type="button"
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'file'}
          on:pointerdown={(event) => handleRootPointerDown(event, 'file')}
          on:click={() => handleRootClick('file')}
        >
          {$t('main.menu.file', { default: 'File' })}
        </button>
        {#if activeMenu === 'file'}
          <MenuSurface
            items={fileMenuItems}
            x={menuPopupX}
            y={menuPopupY}
            ariaLabel={$t('main.menu.file', { default: 'File' })}
            activateOnPointerUpPointerId={menubarPressPointerId}
            on:action={(event) => runMenuAction(event.detail as MenuActionId)}
            on:dismiss={closeMenus}
          />
        {/if}
      </div>

      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('view')}>
        <button
          bind:this={viewMenuTriggerElement}
          class:active={activeMenu === 'view'}
          class="menu-trigger"
          data-menu-interactive="true"
          type="button"
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'view'}
          on:pointerdown={(event) => handleRootPointerDown(event, 'view')}
          on:click={() => handleRootClick('view')}
        >
          {$t('main.menu.view', { default: 'View' })}
        </button>
        {#if activeMenu === 'view'}
          <MenuSurface
            items={viewMenuItems}
            x={menuPopupX}
            y={menuPopupY}
            ariaLabel={$t('main.menu.view', { default: 'View' })}
            activateOnPointerUpPointerId={menubarPressPointerId}
            on:action={(event) => runMenuAction(event.detail as MenuActionId)}
            on:dismiss={closeMenus}
          />
        {/if}
      </div>

      {#if videoActive}
        <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('video')}>
          <button
            bind:this={videoMenuTriggerElement}
            class:active={activeMenu === 'video'}
            class="menu-trigger"
            data-menu-interactive="true"
            type="button"
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'video'}
            on:pointerdown={(event) => handleRootPointerDown(event, 'video')}
            on:click={() => handleRootClick('video')}
          >
            {$t('main.video.menu', { default: 'Video' })}
          </button>
          {#if activeMenu === 'video'}
            <MenuSurface
              items={videoMenuItems}
              x={menuPopupX}
              y={menuPopupY}
              ariaLabel={$t('main.video.menu', { default: 'Video' })}
              activateOnPointerUpPointerId={menubarPressPointerId}
              on:action={(event) => runMenuAction(event.detail as MenuActionId)}
              on:dismiss={closeMenus}
            />
          {/if}
        </div>
      {/if}

      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('help')}>
        <button
          bind:this={helpMenuTriggerElement}
          class:active={activeMenu === 'help'}
          class="menu-trigger"
          data-menu-interactive="true"
          type="button"
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'help'}
          on:pointerdown={(event) => handleRootPointerDown(event, 'help')}
          on:click={() => handleRootClick('help')}
        >
          {$t('main.menu.help', { default: 'Help' })}
        </button>
        {#if activeMenu === 'help'}
          <MenuSurface
            items={helpMenuItems}
            x={menuPopupX}
            y={menuPopupY}
            ariaLabel={$t('main.menu.help', { default: 'Help' })}
            activateOnPointerUpPointerId={menubarPressPointerId}
            on:action={(event) => runMenuAction(event.detail as MenuActionId)}
            on:dismiss={closeMenus}
          />
        {/if}
      </div>
    </div>

    <div
      bind:clientWidth={menuBrandWidth}
      class="menu-brand"
      class:menu-brand-hidden={!showVersionIndicator}
      aria-hidden={!showVersionIndicator}
    >
        <strong>izci</strong>
        <span class="menu-version-indicator">
          {#if updateIndicatorVisible}
            <span
              class:menu-update-completed={displayedUpdateStatus === 'updated'}
              class:menu-update-current={displayedUpdateStatus === 'up-to-date'}
              class:menu-update-failed={displayedUpdateStatus === 'failed'}
              in:fade={{ duration: 240 }}
              out:fade={{ duration: 240 }}
              on:outroend={handleUpdateIndicatorOutroEnd}
            >
              {#if displayedUpdateStatus === 'updated'}
                {$t('main.menu.updateUpdated', { default: 'updated!' })}
              {:else if displayedUpdateStatus === 'up-to-date'}
                {$t('main.menu.updateCurrent', { default: 'up to date' })}
              {:else if displayedUpdateStatus === 'failed'}
                {$t('main.menu.updateFailed', { default: 'update check failed' })}
              {:else}
                {displayVersion}
              {/if}
            </span>
          {/if}
        </span>
    </div>
  {/if}
</nav>

<style>
  .menu-trigger.install-hint-visible::after {
    width: 0.42rem;
    height: 0.42rem;
    margin-left: 0.18rem;
    border-radius: 999px;
    background: #e5a92f;
    box-shadow: 0 0 0 0 rgba(229, 169, 47, 0.42);
    content: '';
    animation: install-hint-pulse 1.4s ease-out 1;
  }

  @keyframes install-hint-pulse {
    0% { box-shadow: 0 0 0 0 rgba(229, 169, 47, 0.42); }
    70% { box-shadow: 0 0 0 0.36rem rgba(229, 169, 47, 0); }
    100% { box-shadow: 0 0 0 0 rgba(229, 169, 47, 0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .menu-trigger.install-hint-visible::after { animation: none; }
  }
</style>
