import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeSidekickMessage } from './multiplayer-sidekick-protocol';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'multiplayer-sidekick-contract');

describe('sidekick contract fixtures', () => {
  const entries = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'));
  it('has fixtures', () => {
    expect(entries.length).toBeGreaterThan(0);
  });
  for (const name of entries) {
    const wantValid = name.startsWith('valid-');
    const wantInvalid = name.startsWith('invalid-');
    it(`${name} is ${wantValid ? 'accepted' : 'rejected'}`, () => {
      expect(wantValid || wantInvalid).toBe(true);
      const data = readFileSync(join(FIXTURE_DIR, name), 'utf8');
      const decoded = decodeSidekickMessage(data);
      if (wantValid) {
        expect(decoded.ok).toBe(true);
      } else {
        expect(decoded.ok).toBe(false);
      }
    });
  }
});
