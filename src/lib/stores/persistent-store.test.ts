import { describe, expect, it } from 'vitest';
import { samePersistentValue } from './persistent-store';

describe('samePersistentValue', () => {
  it('treats separately normalized copies as the same persisted value', () => {
    const first = { enabled: true, effects: [{ id: 'eq', gains: [0, -2.5] }] };
    const second = JSON.parse(JSON.stringify(first));

    expect(samePersistentValue(first, second)).toBe(true);
    expect(samePersistentValue(first, { ...second, enabled: false })).toBe(false);
  });
});
