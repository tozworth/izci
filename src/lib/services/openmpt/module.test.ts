import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { OpenMptCore } from './abi';
import { OpenMptModule } from './module';
import { DEFAULT_OPENMPT_SETTINGS } from './protocol';
import { realOpenMpt, toneModule } from './test-fixtures';

let core: OpenMptCore;
beforeAll(async () => { core = await realOpenMpt(); });

function energy(module: OpenMptModule): number {
  let energy = 0;
  for (let chunk = 0; chunk < 32; chunk++) module.read(48_000, 128, (left, right) => {
    if (chunk > 3) for (const channel of [left, right]) for (const sample of channel) energy += sample * sample;
  });
  return energy;
}

describe('direct libopenmpt WASM bindings', () => {
  it('extracts pattern starts from tempo changes and excludes other subsongs', () => {
    const bytes = new Uint8Array(toneModule(true));
    // Remove the disconnected-order jumps; halve the second pattern's tempo.
    bytes.fill(0, 1084 + 16, 1084 + 20);
    bytes.fill(0, 1084 + 1024 + 16, 1084 + 1024 + 20);
    bytes.set([0, 0, 0x0f, 62], 1084 + 1024 + 4);
    bytes[950] = 3;
    bytes[954] = 0;
    const module = new OpenMptModule(core, bytes.buffer);
    const subsongs = new OpenMptModule(core, toneModule(true), 1);
    try {
      expect(module.inspect(true).song?.patternStartTimes).toEqual([
        0, expect.closeTo(7.68), expect.closeTo(7.68 + 64 * 6 * 2.5 / 62)
      ]);
      module.seek(7.68);
      expect(module.progress()).toMatchObject({ order: 1, row: 0 });
      expect(subsongs.inspect(true).song?.patternStartTimes).toEqual([0]);
      subsongs.selectSubsong(0);
      expect(subsongs.inspect(true).song?.patternStartTimes).toEqual([0]);
    } finally { module.dispose(); subsongs.dispose(); }
  });

  it('reads metadata without formatting cells and extracts patterns separately', () => {
    const format = vi.spyOn(core, '_openmpt_module_format_pattern_row_channel');
    const module = new OpenMptModule(core, toneModule());
    try {
      const { metadata, song } = module.inspect();
      expect(song).toBeUndefined();
      expect(metadata).toMatchObject({ title: 'izci WASM test', channels: 4, patterns: 1, orders: 1, rows: 64, subsongs: 1 });
      expect(metadata.duration).toBeCloseTo(7.68);
      expect(format).not.toHaveBeenCalled();
      expect(module.inspect(true).song?.patterns[0].rows).toHaveLength(64);
      expect(format).toHaveBeenCalledTimes(256);
    } finally { module.dispose(); format.mockRestore(); }
  });

  it('uses real channel mute audio across seeks, settings changes and subsongs', () => {
    const module = new OpenMptModule(core, toneModule(true), 1);
    try {
      module.configure(DEFAULT_OPENMPT_SETTINGS);
      expect(module.inspect().metadata.subsongs).toBe(2);
      expect(module.subsong).toBe(1);
      expect(energy(module)).toBeGreaterThan(0.1);
      module.setChannelMutes([true, false, false, false]);
      energy(module);
      expect(energy(module)).toBeLessThan(1e-10);
      module.seek(0);
      expect(energy(module)).toBeLessThan(1e-10);
      module.configure({ ...DEFAULT_OPENMPT_SETTINGS, interpolationFilter: 8, stereoSeparation: 0, tempoFactor: 0.5, pitchFactor: 2 });
      module.selectSubsong(0);
      expect(energy(module)).toBeLessThan(1e-10);
      module.setChannelMutes([]);
      expect(energy(module)).toBeGreaterThan(0.1);
    } finally { module.dispose(); }
  });

  it('frees input, strings and render buffers, and balances the stack', () => {
    const free = vi.spyOn(core, '_free');
    const allocate = vi.spyOn(core, '_malloc');
    const destroy = vi.spyOn(core, '_openmpt_module_ext_destroy');
    const stringFree = vi.spyOn(core, '_openmpt_free_string');
    const stack = core.stackSave();
    const module = new OpenMptModule(core, toneModule());
    const input = allocate.mock.results[0].value;
    expect(free).toHaveBeenCalledWith(input);
    module.configure({ ...DEFAULT_OPENMPT_SETTINGS, tempoFactor: 0.5 });
    module.setChannelMutes([true]);
    module.inspect(true);
    expect(stringFree.mock.calls.length).toBeGreaterThan(256);
    expect(core.stackSave()).toBe(stack);
    module.read(48_000, 128, () => undefined);
    module.read(48_000, 512, () => undefined);
    module.dispose();
    module.dispose();
    expect(destroy).toHaveBeenCalledOnce();
    expect(free.mock.calls.map(([pointer]) => pointer).sort()).toEqual(allocate.mock.results.map((result) => result.value).sort());
    vi.restoreAllMocks();
  });

  it('rejects malformed data and frees input without a live module', () => {
    const free = vi.spyOn(core, '_free');
    const allocate = vi.spyOn(core, '_malloc');
    expect(() => new OpenMptModule(core, new ArrayBuffer(8))).toThrow('failed to decode');
    expect(free).toHaveBeenCalledExactlyOnceWith(allocate.mock.results[0].value);
    expect(() => new OpenMptModule(core, new ArrayBuffer(0))).toThrow('failed to decode');
    vi.restoreAllMocks();
  });

  it('applies tempo and pitch to the decoder without recreating the module', () => {
    const module = new OpenMptModule(core, toneModule());
    const reference = new OpenMptModule(core, toneModule());
    try {
      reference.configure(DEFAULT_OPENMPT_SETTINGS);
      module.configure({ ...DEFAULT_OPENMPT_SETTINGS, tempoFactor: 0.5, pitchFactor: 2 });
      let fastCrossings = 0;
      let normalCrossings = 0;
      module.read(48_000, 9600, (left) => {
        for (let index = 1000; index < left.length; index++) if (left[index - 1] < 0 && left[index] >= 0) fastCrossings++;
      });
      reference.read(48_000, 9600, (left) => {
        for (let index = 1000; index < left.length; index++) if (left[index - 1] < 0 && left[index] >= 0) normalCrossings++;
      });
      expect(module.progress().row).toBeLessThan(reference.progress().row);
      expect(fastCrossings).toBeGreaterThan(normalCrossings * 1.8);
    } finally { module.dispose(); reference.dispose(); }
  });
});
