import { describe, expect, it } from 'vitest';
import {
  describeAccessAction,
  hasNoSelection,
  isAccessChecking,
  isAccessGranted,
  isNonRestorable
} from './access-status';

describe('owner access contract', () => {
  it('classifies access strings', () => {
    expect(isAccessGranted('granted')).toBe(true);
    expect(isAccessGranted('')).toBe(false);
    expect(isAccessChecking('checking')).toBe(true);
    expect(hasNoSelection('no selected source')).toBe(true);
    expect(isNonRestorable('non-restorable: Plain File selection; choose it again after reload')).toBe(true);
    expect(isNonRestorable('access-required: foo')).toBe(false);
  });

  it('maps to UI actions', () => {
    expect(describeAccessAction('granted')).toBe('play');
    expect(describeAccessAction('checking')).toBe('wait');
    expect(describeAccessAction('no selected source')).toBe('select-track');
    expect(describeAccessAction('non-restorable: gone')).toBe('re-add');
    expect(describeAccessAction('')).toBe('grant-and-retry');
    expect(describeAccessAction('access-required: denied')).toBe('grant-and-retry');
  });
});
