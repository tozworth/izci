import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initializeOpenMpt } from './runtime';
import { OpenMptModule } from './module';
import { DEFAULT_OPENMPT_SETTINGS } from './protocol';
import { toneModule } from './test-fixtures';

describe('shared WASM runtime', () => {
  it('initializes once and isolates concurrent playback handles', async () => {
    const bytes = readFileSync(new URL('../../vendor/libopenmpt/libopenmpt.wasm', import.meta.url));
    const binary = new Uint8Array(bytes).buffer;
    const [first, second] = await Promise.all([initializeOpenMpt(binary), initializeOpenMpt(binary)]);
    expect(first).toBe(second);
    const a = new OpenMptModule(first, toneModule());
    const b = new OpenMptModule(second, toneModule());
    try {
      a.configure(DEFAULT_OPENMPT_SETTINGS);
      b.configure(DEFAULT_OPENMPT_SETTINGS);
      a.setChannelMutes([true]);
      let aEnergy = 0;
      let bEnergy = 0;
      for (let chunk = 0; chunk < 40; chunk++) {
        a.read(48_000, 128, (left) => { if (chunk > 4) for (const value of left) aEnergy += value * value; });
        b.read(48_000, 128, (left) => { if (chunk > 4) for (const value of left) bEnergy += value * value; });
      }
      expect(aEnergy).toBeLessThan(1e-10);
      expect(bEnergy).toBeGreaterThan(0.1);
      a.dispose();
      b.seek(0);
      expect(b.read(48_000, 128, () => undefined)).toBe(128);
    } finally { a.dispose(); b.dispose(); }
  });
});
