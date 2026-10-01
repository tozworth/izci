import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

export const iconSizes = [16, 24, 32, 48, 64, 128, 256];

// Outlined capitals keep the approved lettering independent of installed fonts.
// Each glyph is [advance width, path]; all share a 14-unit cap height.
const letters = {
  A: [10, 'M0 14 5 0l5 14M2 9h6'],
  C: [8, 'M8 1C6-1 0-1 0 4v6c0 5 6 5 8 3'],
  D: [8, 'M0 14V0h3c7 0 7 14 0 14Z'],
  F: [8, 'M0 14V0h8M0 7h6'],
  G: [8, 'M8 1C6-1 0-1 0 4v6c0 5 8 5 8 0V8H5'],
  H: [8, 'M0 0v14M8 0v14M0 7h8'],
  I: [6, 'M0 0h6M3 0v14M0 14h6'],
  L: [8, 'M0 0v14h8'],
  M: [10, 'M0 14V0l5 7 5-7v14'],
  O: [8, 'M4 0a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V4a4 4 0 0 0-4-4Z'],
  P: [8, 'M0 14V0h4.5a3.5 3.5 0 0 1 0 7H0'],
  S: [8, 'M8 0H4a3.5 3.5 0 0 0 0 7h.5a3.5 3.5 0 0 1 0 7H0'],
  T: [10, 'M0 0h10M5 0v14'],
  U: [8, 'M0 0v10a4 4 0 0 0 8 0V0'],
  V: [10, 'M0 0 5 14 10 0'],
  W: [12, 'M0 0 2 14l4-7 4 7 2-14'],
  X: [10, 'M0 0 10 14M10 0 0 14'],
  3: [8, 'M0 0h4a3.5 3.5 0 0 1 0 7H2h2a3.5 3.5 0 0 1 0 7H0'],
};

export function extensionLabel(extension) {
  const label = extension.toUpperCase();
  let width = -5;
  const paths = [...label].map((letter) => {
    const glyph = letters[letter];
    if (!glyph) throw new Error(`No outlined icon glyph for ${letter}`);
    const x = width + 5;
    width = x + glyph[0];
    return `<path transform="translate(${x})" d="${glyph[1]}"/>`;
  });
  return `<g aria-label="${label}" transform="translate(${64 - width / 2} 98)" fill="none" stroke="#122437" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">\n    ${paths.join('\n    ')}\n  </g>`;
}

// PNG-compressed ICO frames retain full alpha, including the document's exterior.
export function encodeIcon(frames) {
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...frames.map(({ png }) => png)]);
}

export function buildFileIcons(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const outputs = new Map();
  const ids = new Set();
  const names = new Set();
  for (const { name, kind, extension, resourceId } of manifest) {
    if (!/^[a-z0-9]+$/.test(name) || !['stream', 'module'].includes(kind)
      || !Number.isInteger(resourceId) || resourceId <= 32512 || resourceId > 65535
      || ids.has(resourceId) || names.has(name)
      || (extension !== null && extension !== name)) throw new Error(`Invalid file icon entry: ${name}`);
    ids.add(resourceId);
    names.add(name);
    const label = extension ? extensionLabel(extension) : '<path d="M35 104h58" stroke="#122437" stroke-width="4" stroke-linecap="round"/>';
    const full = readFileSync(join(directory, 'templates', `${kind}.svg`), 'utf8')
      .replace('<!-- extension-label -->', label)
      .replace(/<title>[^<]+<\/title>/, `<title>izci ${extension ? extension.toUpperCase() : kind} file</title>`);
    outputs.set(`${name}.svg`, Buffer.from(full));
    const frames = iconSizes.map((size) => {
      const svg = size <= 32 ? readFileSync(join(directory, 'templates', `${kind}-${size}.svg`), 'utf8') : full;
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
      return { size, png };
    });
    outputs.set(`${name}.ico`, encodeIcon(frames));
  }
  return outputs;
}
