import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type { Plugin } from 'vite';

const MODULE_ID = 'virtual:milkdrop-presets';
const RESOLVED_MODULE_ID = `\0${MODULE_ID}`;
const require = createRequire(import.meta.url);

export type PresetPart = Record<string, unknown>;
export interface MilkDropPreset extends PresetPart {
  shapes: PresetPart[];
  waves: PresetPart[];
}
export type MilkDropPresetCatalog = Record<string, MilkDropPreset>;

export function readMilkDropPresetCatalog(): { path: string; presets: MilkDropPresetCatalog } {
  const path = require.resolve('butterchurn-presets');
  const module = { exports: {} as { getPresets(): MilkDropPresetCatalog } };
  // Evaluate the installed package in its own Node context so its bundled
  // polyfills cannot affect Vite. None of this code goes into the app runtime.
  runInNewContext(readFileSync(path, 'utf8'), { module, exports: module.exports }, { filename: path, timeout: 5000 });
  return { path, presets: module.exports.getPresets() };
}

function equation(part: PresetPart, key: string, optional = false): string {
  const body = part[`${key}_str`];
  if (body !== undefined && typeof body !== 'string') {
    throw new Error(`MilkDrop ${key}_str must be a string.`);
  }
  // Butterchurn treats absent pixel/point equations as disabled, while init
  // and frame equations must always be callable, even when their body is empty.
  if (optional && !body) return "''";
  return `function(a) {\n${body ?? ''}\nreturn a;\n}`;
}

function serializePart(part: PresetPart, equationKeys: string[], optionalKeys: string[] = []): string {
  const data = Object.fromEntries(Object.entries(part).filter(([key]) => !key.endsWith('_eqs_str')));
  const functions = equationKeys.map((key) => `${JSON.stringify(key)}: ${equation(part, key, optionalKeys.includes(key))}`);
  return `{...${JSON.stringify(data)}, ${functions.join(', ')}}`;
}

export function compileMilkDropPresetModule(presets: MilkDropPresetCatalog): string {
  const entries = Object.entries(presets).map(([name, preset]) => {
    const { shapes, waves, ...base } = preset;
    const compiledBase = serializePart(base, ['init_eqs', 'frame_eqs', 'pixel_eqs'], ['pixel_eqs']);
    const compiledShapes = shapes.map((shape) => serializePart(shape, ['init_eqs', 'frame_eqs']));
    const compiledWaves = waves.map((wave) => serializePart(wave, ['init_eqs', 'frame_eqs', 'point_eqs'], ['point_eqs']));
    return `${JSON.stringify(name)}: {...${compiledBase}, shapes: [${compiledShapes.join(',')}], waves: [${compiledWaves.join(',')}]}`;
  });
  // Equation bodies become ordinary bundled functions. Their EEL math helpers
  // are supplied by Butterchurn, just as for its new Function() compilation path.
  return `const presets = {\n${entries.join(',\n')}\n};\nexport default presets;\n`;
}

export function milkDropPresetsPlugin(): Plugin {
  return {
    name: 'precompile-milkdrop-presets',
    resolveId(id) {
      return id === MODULE_ID ? RESOLVED_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_MODULE_ID) return null;
      const { path, presets } = readMilkDropPresetCatalog();
      this.addWatchFile(path);
      return compileMilkDropPresetModule(presets);
    }
  };
}
