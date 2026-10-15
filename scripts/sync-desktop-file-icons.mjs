import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { buildFileIcons, encodeIcon, iconSizes } from './desktop/file-icons.mjs';

const directory = resolve(import.meta.dirname, '../src-tauri/icons');
if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/sync-desktop-file-icons.mjs [--check]');
const check = process.argv.includes('--check');
const fileIcons = buildFileIcons(join(directory, 'file-types'));
const outputs = new Map([...fileIcons].map(([name, bytes]) => [join('file-types', name), bytes]));
// Keep the light desktop application icon separate from the dark PWA artwork.
const svg = readFileSync(join(directory, 'icon.svg'), 'utf8');
const render = (size) => new Resvg(svg, {
  fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false },
}).render().asPng();
outputs.set('icon.png', render(512));
outputs.set('icon.ico', encodeIcon(iconSizes.map((size) => ({ size, png: render(size) }))));
// Rasterize the same transparent mark used by the menu bar. Native tray code
// applies the user's light/dark color to this alpha mask without image decoders.
// Tighten the tray-only viewport so the mark fills the small shell icon slot.
const mark = readFileSync(resolve(directory, '../../public/icons/izci-mark.svg'), 'utf8')
  .replace('viewBox="0 0 512 512"', 'viewBox="64 64 384 384"');
const pixels = new Resvg(mark, {
  fitTo: { mode: 'width', value: 32 }, font: { loadSystemFonts: false },
}).render().pixels;
outputs.set('tray-mark.alpha', Buffer.from(Array.from({ length: 32 * 32 }, (_, index) => pixels[index * 4 + 3])));
for (const [name, bytes] of outputs) {
  const path = join(directory, name);
  const current = existsSync(path) ? readFileSync(path) : null;
  if (current?.equals(bytes)) continue;
  if (check) throw new Error(`Stale desktop icon: ${name}. Run npm run desktop:icons.`);
  writeFileSync(path, bytes);
}
console.log(`${check ? 'Verified' : 'Generated'} application icon, tray glyph and ${fileIcons.size / 2} file icons, each with 16/24/32/48/64/128/256 px frames.`);
