import { describe, expect, it } from 'vitest';
import {
  capabilityDbNameForProfile,
  channelNameForProfile,
  lockNameForProfile,
  opfsDirectoryForProfile,
  validateProfileName
} from './profile-names';

describe('profile storage namespaces', () => {
  it('derives collision-free names for valid profiles', () => {
    expect(() => validateProfileName('default')).not.toThrow();
    expect(opfsDirectoryForProfile('default')).toBe('/izci-v1/default');
    expect(capabilityDbNameForProfile('default')).toBe('izci-capabilities-v1-default');
    expect(channelNameForProfile('default')).toBe('izci-v1-default');
    expect(lockNameForProfile('default')).toBe('izci-profile-v1-default');
    // Crude names must never be produced here.
    for (const derived of [
      opfsDirectoryForProfile('x'),
      capabilityDbNameForProfile('x'),
      channelNameForProfile('x'),
      lockNameForProfile('x')
    ]) {
      expect(derived).not.toContain('crude');
    }
  });

  it('rejects malformed profile names', () => {
    expect(() => validateProfileName('')).toThrow();
    expect(() => validateProfileName('a'.repeat(65))).toThrow();
    expect(() => validateProfileName('has space')).toThrow();
    expect(() => validateProfileName('has/slash')).toThrow();
    expect(() => opfsDirectoryForProfile('')).toThrow();
  });
});
