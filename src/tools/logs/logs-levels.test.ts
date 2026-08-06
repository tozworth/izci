import { describe, expect, it } from 'vitest';

import {
  LOG_LEVEL_DEFAULT_VISIBILITY,
  normalizeLogLevelVisibility
} from './logs-levels';

describe('log level visibility helpers', () => {
  it('defaults to every level visible except debug', () => {
    expect(LOG_LEVEL_DEFAULT_VISIBILITY).toEqual({
      error: true,
      warning: true,
      info: true,
      debug: false
    });
  });

  it('falls back to defaults for garbage or missing payloads', () => {
    expect(normalizeLogLevelVisibility(undefined)).toEqual(LOG_LEVEL_DEFAULT_VISIBILITY);
    expect(normalizeLogLevelVisibility(null)).toEqual(LOG_LEVEL_DEFAULT_VISIBILITY);
    expect(normalizeLogLevelVisibility('garbage')).toEqual(LOG_LEVEL_DEFAULT_VISIBILITY);
    expect(normalizeLogLevelVisibility({})).toEqual(LOG_LEVEL_DEFAULT_VISIBILITY);
  });

  it('keeps provided booleans and fills missing levels from defaults', () => {
    expect(
      normalizeLogLevelVisibility({
        error: false,
        debug: true
      })
    ).toEqual({
      error: false,
      warning: true,
      info: true,
      debug: true
    });
  });

  it('rejects non-boolean entries for a level', () => {
    expect(
      normalizeLogLevelVisibility({
        warning: 'yes',
        debug: 1
      })
    ).toEqual(LOG_LEVEL_DEFAULT_VISIBILITY);
  });
});
