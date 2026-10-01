export type OptionsViewName =
  | 'appearance'
  | 'backdrops'
  | 'now-playing'
  | 'lyrics'
  | 'playback'
  | 'oda'
  | 'video'
  | 'raf'
  | 'visualizer'
  | 'patterns'
  | 'modules'
  | 'loadouts'
  | 'tracks'
  | 'folders'
  | 'metadata'
  | 'backups'
  | 'multiplayer'
  | 'hosting'
  | 'experimental'
  | 'cache'
  | 'about'
  | 'licenses';

export const DEFAULT_OPTIONS_VIEW: OptionsViewName = 'appearance';
const OPTIONS_VIEW_QUERY_PARAM = 'view';

interface OptionsViewDefinition {
  id: OptionsViewName;
  label: string;
  icon: string;
  parentLabel: string;
  hasHints: boolean;
  hasAdvancedTweaks?: boolean;
  resettable: boolean;
}

export const OPTIONS_VIEW_GROUPS: OptionsViewDefinition[][] = [
  [
    {
      id: 'appearance',
      label: 'Appearance',
      icon: 'palette',
      parentLabel: '',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    },
    {
      id: 'backdrops',
      label: 'Backdrops',
      icon: 'wallpaper',
      parentLabel: 'Appearance',
      hasHints: true,
      resettable: true
    },
    {
      id: 'now-playing',
      label: 'Now Playing',
      icon: 'album',
      parentLabel: 'Appearance',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    },
    {
      id: 'visualizer',
      label: 'Visualizer',
      icon: 'graphic_eq',
      parentLabel: 'Appearance',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    },
    {
      id: 'patterns',
      label: 'Patterns',
      icon: 'view_timeline',
      parentLabel: 'Appearance',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    },
    {
      id: 'lyrics',
      label: 'Lyrics',
      icon: 'lyrics',
      parentLabel: 'Appearance',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    },
    {
      id: 'playback',
      label: 'Playback',
      icon: 'play_circle',
      parentLabel: '',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    },
    {
      id: 'video',
      label: 'Video',
      icon: 'movie',
      parentLabel: 'Playback',
      hasHints: true,
      resettable: true
    },
    {
      id: 'raf',
      label: 'Raf',
      icon: 'tune',
      parentLabel: 'Playback',
      hasHints: false,
      resettable: true
    },
    {
      id: 'modules',
      label: 'Modules',
      icon: 'memory',
      parentLabel: 'Playback',
      hasHints: true,
      resettable: true
    }
  ],
  [
    {
      id: 'oda',
      label: 'Oda',
      icon: 'tv',
      parentLabel: '',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    }
  ],
  [
    {
      id: 'tracks',
      label: 'Tracks',
      icon: 'library_music',
      parentLabel: '',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    },
    {
      id: 'folders',
      label: 'Folders',
      icon: 'folder_copy',
      parentLabel: 'Tracks',
      hasHints: true,
      resettable: false
    },
    {
      id: 'metadata',
      label: 'Metadata',
      icon: 'tag',
      parentLabel: 'Tracks',
      hasHints: true,
      hasAdvancedTweaks: true,
      resettable: true
    }
  ],
  [
    {
      id: 'loadouts',
      label: 'Loadouts',
      icon: 'bookmark_manager',
      parentLabel: '',
      hasHints: true,
      resettable: false
    }
  ],
  [
    {
      id: 'backups',
      label: 'Backups',
      icon: 'archive',
      parentLabel: '',
      hasHints: false,
      resettable: false
    }
  ],
  [
    {
      id: 'multiplayer',
      label: 'Multiplayer',
      icon: 'group',
      parentLabel: '',
      hasHints: true,
      resettable: true
    },
    {
      id: 'hosting',
      label: 'Hosting',
      icon: 'dns',
      parentLabel: 'Multiplayer',
      hasAdvancedTweaks: true,
      hasHints: true,
      resettable: true
    },
    {
      id: 'cache',
      label: 'Cache',
      icon: 'database',
      parentLabel: 'Multiplayer',
      hasHints: true,
      resettable: true
    }
  ],
  [
    {
      id: 'experimental',
      label: 'Experimental',
      icon: 'science',
      parentLabel: '',
      hasHints: false,
      resettable: false
    }
  ],
  [
    {
      id: 'about',
      label: 'About',
      icon: 'info',
      parentLabel: '',
      hasHints: false,
      resettable: false
    }
  ]
];

const AUXILIARY_OPTIONS_VIEWS: OptionsViewDefinition[] = [
  {
    id: 'licenses',
    label: 'Licenses',
    icon: 'license',
    parentLabel: 'About',
    hasHints: false,
    resettable: false
  }
];

export const OPTIONS_VIEWS = Object.fromEntries(
  [...OPTIONS_VIEW_GROUPS.flat(), ...AUXILIARY_OPTIONS_VIEWS].map((view) => [view.id, view])
) as Record<OptionsViewName, OptionsViewDefinition>;

export function isOptionsViewName(value: string | null | undefined): value is OptionsViewName {
  return typeof value === 'string' && value in OPTIONS_VIEWS;
}

function normalizeOptionsView(value: string | null | undefined): OptionsViewName {
  return isOptionsViewName(value) ? value : DEFAULT_OPTIONS_VIEW;
}

export function buildOptionsWindowPath(view: OptionsViewName = DEFAULT_OPTIONS_VIEW): string {
  const params = new URLSearchParams();

  if (view !== DEFAULT_OPTIONS_VIEW) {
    params.set(OPTIONS_VIEW_QUERY_PARAM, view);
  }

  const query = params.toString();
  return query ? `/options.html?${query}` : '/options.html';
}

export function getOptionsViewFromLocation(locationLike: Pick<Location, 'search'>): OptionsViewName {
  return normalizeOptionsView(new URLSearchParams(locationLike.search).get(OPTIONS_VIEW_QUERY_PARAM));
}
