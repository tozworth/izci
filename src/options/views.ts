export type OptionsViewName =
  | 'appearance'
  | 'now-playing'
  | 'lyrics'
  | 'playback'
  | 'visualizer'
  | 'modules'
  | 'metadata'
  | 'about';

export const DEFAULT_OPTIONS_VIEW: OptionsViewName = 'appearance';
export const OPTIONS_VIEW_QUERY_PARAM = 'view';

export interface OptionsViewDefinition {
  id: OptionsViewName;
  label: string;
  icon: string;
  parentLabel: string;
  hasHints: boolean;
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
      resettable: true
    },
    {
      id: 'now-playing',
      label: 'Now Playing',
      icon: 'album',
      parentLabel: 'Appearance',
      hasHints: true,
      resettable: true
    },
    {
      id: 'lyrics',
      label: 'Lyrics',
      icon: 'lyrics',
      parentLabel: 'Appearance',
      hasHints: true,
      resettable: true
    },
    {
      id: 'playback',
      label: 'Playback',
      icon: 'play_circle',
      parentLabel: '',
      hasHints: true,
      resettable: true
    }
  ],
  [
    {
      id: 'visualizer',
      label: 'Visualizer',
      icon: 'graphic_eq',
      parentLabel: 'Playback',
      hasHints: true,
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
      id: 'metadata',
      label: 'Metadata',
      icon: 'tag',
      parentLabel: '',
      hasHints: true,
      resettable: true
    },
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

export const OPTIONS_VIEWS = Object.fromEntries(
  OPTIONS_VIEW_GROUPS.flat().map((view) => [view.id, view])
) as Record<OptionsViewName, OptionsViewDefinition>;

export function isOptionsViewName(value: string | null | undefined): value is OptionsViewName {
  return typeof value === 'string' && value in OPTIONS_VIEWS;
}

export function normalizeOptionsView(value: string | null | undefined): OptionsViewName {
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
