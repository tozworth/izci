import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  compileMilkDropPresetModule, milkDropPresetsPlugin, readMilkDropPresetCatalog,
  type MilkDropPresetCatalog, type PresetPart
} from './milkdrop-presets';

const require = createRequire(import.meta.url);
const engineSource = readFileSync(require.resolve('butterchurn'), 'utf8');
const catalog = readMilkDropPresetCatalog().presets;

function createEngineContext(allowCompilation: boolean) {
  const context = createContext({ module: { exports: {} }, exports: {} }, {
    codeGeneration: { strings: allowCompilation, wasm: false }
  });
  new Script('globalThis.window = globalThis; Math.random = () => 0.25;').runInContext(context);
  // Load Butterchurn's actual EEL helpers; constructing a renderer is unnecessary.
  new Script(engineSource).runInContext(context);
  return context;
}

function loadCompiledCatalog(presets = catalog) {
  const context = createEngineContext(false);
  const source = compileMilkDropPresetModule(presets).replace('export default presets;', 'globalThis.catalog = presets;');
  // This models loading static JS under CSP with string compilation disabled.
  new Script(`'use strict';\n${source}`).runInContext(context);
  return { context, presets: context.catalog as MilkDropPresetCatalog };
}

function equationInput() {
  return new Proxy<Record<string, unknown>>({
    bass: 0.8, bass_att: 0.6, mid: 0.5, mid_att: 0.4, treb: 0.3, treb_att: 0.2,
    time: 12, frame: 120, fps: 60, rad: 0.4, ang: 1, x: 0.2, y: 0.8,
    sample: 0.25, value1: 0.3, value2: 0.7,
    megabuf: new Float64Array(4096), gmegabuf: new Float64Array(4096)
  }, {
    get: (target, key: string) => key in target ? target[key] : 0
  });
}

describe('precompiled MilkDrop presets', () => {
  it('loads all 100 bundled presets through Butterchurn with runtime compilation forbidden', () => {
    const { context, presets } = loadCompiledCatalog();
    expect(Object.keys(presets)).toEqual(Object.keys(catalog));
    expect(Object.keys(presets)).toHaveLength(100);
    expect(() => new Script('new Function("return 1")').runInContext(context)).toThrow();

    // Exercise the installed engine's actual preset loader in isolation from GL.
    // A raw preset enters new Function(); a precompiled one must never do so.
    const method = engineSource.match(/value: (function loadPreset\(presetMap\) \{[\s\S]*?\n    \})\n  \},/);
    expect(method).not.toBeNull();
    new Script(`globalThis.loadPreset = (${method![1]});`).runInContext(context);
    const loaded: unknown[] = [];
    const receiver = {
      baseValsDefaults: {}, shapeBaseValsDefaults: {}, waveBaseValsDefaults: {},
      renderer: { loadPreset: (preset: unknown) => { loaded.push(preset); } }
    };
    const loadPreset = context.loadPreset as (this: typeof receiver, preset: unknown) => void;
    expect(() => loadPreset.call(receiver, catalog[Object.keys(catalog)[0]])).toThrow();
    for (const preset of Object.values(presets)) loadPreset.call(receiver, preset);
    expect(loaded).toHaveLength(100);
  });

  it('preserves equation results, EEL helpers, shader data, and empty optional equations', () => {
    const { presets } = loadCompiledCatalog();
    const referenceContext = createEngineContext(true);
    let compared = 0;

    function comparePart(raw: PresetPart, compiled: PresetPart, keys: string[]) {
      const actualInput = equationInput();
      const referenceInput = equationInput();
      for (const key of keys) {
        const body = raw[`${key}_str`] as string | undefined;
        if ((key === 'pixel_eqs' || key === 'point_eqs') && !body) {
          expect(compiled[key]).toBe('');
          continue;
        }
        const reference = new Script(`new Function('a', ${JSON.stringify(`${body ?? ''}\nreturn a;`)})`)
          .runInContext(referenceContext) as (input: typeof referenceInput) => typeof referenceInput;
        const actual = compiled[key] as (input: typeof actualInput) => typeof actualInput;
        expect(actual(actualInput)).toBe(actualInput);
        reference(referenceInput);
        // Compare numeric state and buffer contents without enumerating every
        // typed-array element through the deep-equality matcher.
        const { megabuf: actualBuffer, gmegabuf: actualGlobalBuffer, ...actualState } = actualInput;
        const { megabuf: referenceBuffer, gmegabuf: referenceGlobalBuffer, ...referenceState } = referenceInput;
        expect(actualState).toEqual(referenceState);
        for (const [actualValues, referenceValues] of [
          [actualBuffer, referenceBuffer], [actualGlobalBuffer, referenceGlobalBuffer]
        ]) {
          expect(Buffer.from((actualValues as Float64Array).buffer)
            .equals(Buffer.from((referenceValues as Float64Array).buffer))).toBe(true);
        }
        expect(compiled).not.toHaveProperty(`${key}_str`);
        compared++;
      }
      expect(compiled.baseVals).toEqual(raw.baseVals);
    }

    for (const [name, raw] of Object.entries(catalog)) {
      const compiled = presets[name];
      comparePart(raw, compiled, ['init_eqs', 'frame_eqs', 'pixel_eqs']);
      raw.shapes.forEach((shape, index) => comparePart(shape, compiled.shapes[index], ['init_eqs', 'frame_eqs']));
      raw.waves.forEach((wave, index) => comparePart(wave, compiled.waves[index], ['init_eqs', 'frame_eqs', 'point_eqs']));
      expect(compiled.warp).toBe(raw.warp);
      expect(compiled.comp).toBe(raw.comp);
    }
    expect(compared).toBeGreaterThan(200);
  });

  it('provides the same local virtual module in desktop and PWA configurations', () => {
    const plugin = milkDropPresetsPlugin();
    const resolve = plugin.resolveId as (id: string) => string | null;
    const id = resolve('virtual:milkdrop-presets');
    expect(id).toBe('\0virtual:milkdrop-presets');
    expect(resolve('unrelated')).toBeNull();
    const watched: string[] = [];
    const load = plugin.load as (this: { addWatchFile(path: string): void }, id: string) => string | null;
    expect(load.call({ addWatchFile: (path) => { watched.push(path); } }, id!)).toBe(compileMilkDropPresetModule(catalog));
    expect(watched).toEqual([readMilkDropPresetCatalog().path]);
    expect(load.call({ addWatchFile() {} }, 'unrelated')).toBeNull();
  });
});
