import type { SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';

export type TroubadourOptionsViewName = 'general' | 'metadata' | 'artwork' | 'rename' | 'files' | 'advanced';

export const DEFAULT_TROUBADOUR_OPTIONS_VIEW: TroubadourOptionsViewName = 'general';

export const TROUBADOUR_OPTIONS_VIEW_GROUPS: SharedOptionsViewDefinition[][] = [
  [
    { id: 'general', label: 'General', icon: 'tune', hasHints: true, hasAdvancedTweaks: false, resettable: true },
    { id: 'metadata', label: 'Metadata', icon: 'tag', hasHints: true, hasAdvancedTweaks: true, resettable: true },
    { id: 'artwork', label: 'Artwork', icon: 'image', hasHints: true, hasAdvancedTweaks: false, resettable: true },
    { id: 'rename', label: 'Rename', icon: 'drive_file_rename_outline', hasHints: true, hasAdvancedTweaks: true, resettable: true }
  ],
  [
    { id: 'files', label: 'Files and safety', icon: 'verified_user', hasHints: true, hasAdvancedTweaks: true, resettable: true },
    { id: 'advanced', label: 'Advanced', icon: 'settings_suggest', hasHints: true, hasAdvancedTweaks: true, resettable: true }
  ]
];

export function isTroubadourOptionsViewName(value: unknown): value is TroubadourOptionsViewName {
  return typeof value === 'string' && TROUBADOUR_OPTIONS_VIEW_GROUPS.flat().some((view) => view.id === value);
}

export function getTroubadourOptionsViewFromLocation(
  locationLike: Pick<Location, 'search'>
): TroubadourOptionsViewName {
  const requested = new URLSearchParams(locationLike.search).get('view');
  return isTroubadourOptionsViewName(requested) ? requested : DEFAULT_TROUBADOUR_OPTIONS_VIEW;
}

export function buildTroubadourOptionsPath(view: TroubadourOptionsViewName): string {
  return view === DEFAULT_TROUBADOUR_OPTIONS_VIEW
    ? '/troubadour-options.html'
    : `/troubadour-options.html?view=${encodeURIComponent(view)}`;
}
