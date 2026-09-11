import { describe, expect, it } from 'vitest';
import { OPTIONS_VIEW_GROUPS } from '../options/views';
import {
  buildOdaOptionsGroups,
  ODA_OPTIONS_EXIT_FOCUS_ID,
  odaOptionsCategoryFocusId
} from './oda-options-groups';
import type { OdaTranslate } from './oda-translate';

const translate: OdaTranslate = (key, fallback) => fallback;

describe('buildOdaOptionsGroups', () => {
  it('moves the Oda group first without mutating the canonical groups', () => {
    const before = JSON.stringify(OPTIONS_VIEW_GROUPS);
    const { groups } = buildOdaOptionsGroups(translate, true);

    expect(groups[0].some((view) => view.id === 'oda')).toBe(true);
    expect(JSON.stringify(OPTIONS_VIEW_GROUPS)).toBe(before);

    const odaGroupCount = groups.filter((group) => group.some((view) => view.id === 'oda')).length;
    expect(odaGroupCount).toBe(1);
    expect(groups.flat()).toHaveLength(OPTIONS_VIEW_GROUPS.flat().length);
  });

  it('hides Raf when it is disabled', () => {
    const disabled = buildOdaOptionsGroups(translate, false).groups.flat();
    const enabled = buildOdaOptionsGroups(translate, true).groups.flat();
    expect(disabled.find((view) => view.id === 'raf')?.hidden).toBe(true);
    expect(enabled.find((view) => view.id === 'raf')?.hidden).toBe(false);
  });

  it('keeps licenses reachable as an auxiliary view', () => {
    const { auxiliaryViews } = buildOdaOptionsGroups(translate, true);
    expect(auxiliaryViews.map((view) => view.id)).toContain('licenses');
  });

  it('builds stable focus ids', () => {
    expect(ODA_OPTIONS_EXIT_FOCUS_ID).toBe('option:exit-oda');
    expect(odaOptionsCategoryFocusId('appearance')).toBe('option:appearance');
  });
});
