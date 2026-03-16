export type OptionsViewName = 'playback' | 'modules' | 'metadata' | 'about';

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
      id: 'playback',
      label: 'Playback',
      icon: 'play_circle',
      parentLabel: '',
      hasHints: false,
      resettable: false
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
