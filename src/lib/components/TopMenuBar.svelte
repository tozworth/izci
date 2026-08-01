<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { version as appVersion } from '../../../package.json';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { applyManualLoadoutSettings } from '$lib/services/loadouts';
  import { pwaUpdateStatus } from '$lib/services/pwa-updates';
  import { loadouts } from '$lib/stores/loadouts';
  import type {
    MenuActionItem,
    VideoFitMode,
    WindowMenuGroup,
    WindowMenuSubtitleTone
  } from '$lib/types';
  import { getLoadoutColorValue, LOADOUT_TYPE_ICONS } from '$lib/utils/loadout-presentation';
  import { formatDisplayVersion } from '$lib/utils/version';
  import type { OptionsViewName } from '../../options/views';

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
  let installHintPresentedInOpenMenu = false;
  let menuSubtitleTone: WindowMenuSubtitleTone = 'muted';

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
  $: menuGroups = [
    {
      id: 'app',
      label: $t('main.menu.applicationMenu', { default: 'Application menu' }),
      items: appMenuItems,
      application: true,
      attention: showInstallHint
    },
    {
      id: 'file',
      label: $t('main.menu.file', { default: 'File' }),
      icon: 'folder',
      items: fileMenuItems
    },
    {
      id: 'view',
      label: $t('main.menu.view', { default: 'View' }),
      icon: 'visibility',
      items: viewMenuItems
    },
    ...(videoActive
      ? [{
          id: 'video',
          label: $t('main.video.menu', { default: 'Video' }),
          icon: 'movie',
          items: videoMenuItems
        } satisfies WindowMenuGroup]
      : []),
    {
      id: 'help',
      label: $t('main.menu.help', { default: 'Help' }),
      icon: 'help',
      items: helpMenuItems
    }
  ] satisfies WindowMenuGroup[];
  $: menuSubtitle = $pwaUpdateStatus === 'updated'
    ? $t('main.menu.updateUpdated', { default: 'updated!' })
    : $pwaUpdateStatus === 'up-to-date'
      ? $t('main.menu.updateCurrent', { default: 'up to date' })
      : $pwaUpdateStatus === 'failed'
        ? $t('main.menu.updateFailed', { default: 'update check failed' })
        : displayVersion;
  $: menuSubtitleTone =
    $pwaUpdateStatus === 'updated'
      ? 'success'
      : $pwaUpdateStatus === 'up-to-date'
        ? 'current'
        : $pwaUpdateStatus === 'failed'
          ? 'warning'
          : 'muted';

  function runMenuAction(action: MenuActionId) {
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
</script>

<WindowMenuBar
  bind:height
  groups={menuGroups}
  title="izci"
  subtitle={menuSubtitle}
  subtitleTone={menuSubtitleTone}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  on:menuopen={(event) => {
    if (event.detail === 'app' && showInstallHint) {
      installHintPresentedInOpenMenu = true;
      dispatch('acknowledgeInstallHint');
    }
  }}
  on:menuclose={() => installHintPresentedInOpenMenu = false}
  on:action={(event) => runMenuAction(event.detail as MenuActionId)}
/>
