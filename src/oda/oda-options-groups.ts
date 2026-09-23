import type { SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';
import { OPTIONS_VIEW_GROUPS, OPTIONS_VIEWS, type OptionsViewName } from '../options/views';
import type { OdaTranslate } from './oda-translate';

/** I18n keys already present for the desktop Options window. */
const VIEW_LABEL_KEYS: Record<OptionsViewName, string> = {
  appearance: 'options.views.appearance',
  backdrops: 'options.views.backdrops',
  'now-playing': 'options.views.nowPlaying',
  lyrics: 'options.views.lyrics',
  playback: 'options.views.playback',
  oda: 'options.views.oda',
  video: 'options.views.video',
  raf: 'options.views.raf',
  visualizer: 'options.views.visualizer',
  patterns: 'options.views.patterns',
  modules: 'options.views.modules',
  loadouts: 'options.views.loadouts',
  tracks: 'options.views.tracks',
  folders: 'options.views.folders',
  metadata: 'options.views.metadata',
  backups: 'options.views.backups',
  multiplayer: 'options.views.multiplayer',
  hosting: 'options.views.hosting',
  experimental: 'options.views.experimental',
  cache: 'options.views.cache',
  about: 'options.views.about',
  licenses: 'options.views.licenses'
};

function parentViewId(view: OptionsViewName): OptionsViewName | null {
  if (view === 'backdrops' || view === 'now-playing' || view === 'visualizer' || view === 'patterns' || view === 'lyrics') return 'appearance';
  if (view === 'video' || view === 'raf' || view === 'modules') return 'playback';
  if (view === 'folders' || view === 'metadata') return 'tracks';
  if (view === 'hosting' || view === 'cache') return 'multiplayer';
  if (view === 'licenses') return 'about';
  return null;
}

function toDefinition(
  id: OptionsViewName,
  translate: OdaTranslate,
  enableRaf: boolean
): SharedOptionsViewDefinition {
  const definition = OPTIONS_VIEWS[id];
  return {
    id: definition.id,
    label: translate(VIEW_LABEL_KEYS[id], definition.label),
    icon: definition.icon,
    parentId: parentViewId(id),
    hasHints: definition.hasHints,
    hasAdvancedTweaks: definition.hasAdvancedTweaks,
    resettable: definition.resettable,
    hidden: id === 'raf' && !enableRaf
  };
}

/**
 * Build the Oda-native Options categories. The canonical exported groups are
 * never mutated: a derived copy is reordered so Oda is first.
 */
export function buildOdaOptionsGroups(
  translate: OdaTranslate,
  enableRaf: boolean
): { groups: SharedOptionsViewDefinition[][]; auxiliaryViews: SharedOptionsViewDefinition[] } {
  const built = OPTIONS_VIEW_GROUPS.map((group) =>
    group.map((definition) => toDefinition(definition.id, translate, enableRaf))
  );

  const odaGroupIndex = built.findIndex((group) => group.some((view) => view.id === 'oda'));
  const reordered = odaGroupIndex > 0
    ? [built[odaGroupIndex], ...built.slice(0, odaGroupIndex), ...built.slice(odaGroupIndex + 1)]
    : built;

  return {
    groups: reordered,
    auxiliaryViews: [toDefinition('licenses', translate, enableRaf)]
  };
}

export function odaOptionsCategoryFocusId(view: OptionsViewName): string {
  return `option:${view}`;
}
