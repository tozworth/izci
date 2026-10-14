import type { MenuActionItem, RafPresetState, RafRackSettings } from '$lib/types';
import { isRafPresetDirty, rafPresets } from '$lib/stores/raf-presets';
import { rafSettings } from '$lib/stores/raf-settings';
import { getLoadoutColorValue } from '$lib/utils/loadout-presentation';
import type { MenuTranslation } from './menu-format';

interface RafMenuDeps {
  translate: MenuTranslation;
  rafSettings: RafRackSettings;
  rafPresets: RafPresetState;
}

export function buildRafMenuItems(deps: RafMenuDeps): MenuActionItem[] {
  return [
    {
      id: 'toggleRaf',
      label: deps.rafSettings.enabled
        ? deps.translate('main.player.bypassRaf', { default: 'Bypass Raf' })
        : deps.translate('main.menu.enableRaf', { default: 'Enable Raf' }),
      icon: 'power_settings_new'
    },
    {
      id: 'openRaf',
      label: deps.translate('main.player.openRaf', { default: 'Open Raf' }),
      icon: 'tune'
    },
    ...(deps.rafPresets.presets.length > 0
      ? deps.rafPresets.presets.map((preset, index) => ({
          id: `applyRafPreset:${preset.id}`,
          label: `${preset.name}${preset.id === deps.rafPresets.selectedPresetId && isRafPresetDirty(deps.rafPresets, deps.rafSettings) ? ' *' : ''}`,
          icon: preset.icon ?? 'tune',
          iconColor: getLoadoutColorValue(preset.color),
          checked: preset.id === deps.rafPresets.selectedPresetId,
          separatorBefore: index === 0
        }) satisfies MenuActionItem)
      : [{
          id: 'rafNoPresets',
          label: deps.translate('main.player.noRafPresets', { default: 'No Raf presets' }),
          icon: 'tune',
          disabled: true,
          separatorBefore: true
        } satisfies MenuActionItem])
  ] satisfies MenuActionItem[];
}

export type RafMenuAction = 'toggleRaf' | 'openRaf' | `applyRafPreset:${string}`;

export function isRafMenuAction(action: string): action is RafMenuAction {
  return action === 'toggleRaf' || action === 'openRaf' || /^applyRafPreset:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(action);
}

export function runRafMenuAction(action: RafMenuAction, openRaf: () => void): void {
  if (action === 'toggleRaf') rafSettings.setEnabled(!rafSettings.getSnapshot().enabled);
  else if (action === 'openRaf') openRaf();
  else rafPresets.apply(action.slice('applyRafPreset:'.length));
}
