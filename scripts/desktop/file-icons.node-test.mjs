import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { buildFileIcons, encodeIcon, extensionLabel, iconSizes } from './file-icons.mjs';

const directory = resolve(import.meta.dirname, '../../src-tauri/icons/file-types');
const outputs = buildFileIcons(directory);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function frames(ico) {
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  let offset = 6 + count * 16;
  const result = new Map();
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = ico[entry] || 256;
    assert.equal(ico[entry + 1] || 256, size);
    assert.equal(ico.readUInt16LE(entry + 4), 1);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    assert.equal(ico.readUInt32LE(entry + 12), offset);
    const length = ico.readUInt32LE(entry + 8);
    const png = ico.subarray(offset, offset + length);
    assert(png.subarray(0, 8).equals(pngSignature));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[25], 6, 'Icon frames must have RGBA transparency');
    result.set(size, png);
    offset += length;
  }
  assert.equal(offset, ico.length, 'No missing/trailing image data');
  assert.deepEqual([...result.keys()], iconSizes);
  return result;
}

test('ICO frames retain their exact PNG bytes and dimensions', () => {
  for (const [name, bytes] of outputs) {
    if (!name.endsWith('.ico')) continue;
    const parsed = frames(bytes);
    assert(encodeIcon([...parsed].map(([size, png]) => ({ size, png }))).equals(bytes));
    assert(readFileSync(resolve(directory, name)).equals(bytes), `Stale checked-in icon: ${name}`);
  }
});

test('small frames share the simple media-kind design while large frames show the extension', () => {
  const opus = frames(outputs.get('opus.ico'));
  const flac = frames(outputs.get('flac.ico'));
  const mptm = frames(outputs.get('mptm.ico'));
  const fallback = frames(outputs.get('module.ico'));
  for (const size of iconSizes) {
    if (size <= 32) {
      assert(opus.get(size).equals(flac.get(size)));
      assert(mptm.get(size).equals(fallback.get(size)));
    } else {
      assert(!opus.get(size).equals(flac.get(size)));
      assert(!mptm.get(size).equals(fallback.get(size)));
    }
    assert(!opus.get(size).equals(mptm.get(size)));
  }
  for (const [name, svg] of outputs) {
    if (!name.endsWith('.svg')) continue;
    const text = svg.toString();
    assert(!/<text|<image|<use|<!-- extension-label -->/.test(text));
    if (name === 'module.svg') assert(text.includes('M35 104h58'));
    else assert(text.includes(`aria-label="${name.slice(0, -4).toUpperCase()}"`));
  }
});

test('all requested extension glyphs fit inside the document', () => {
  for (const extension of ['mp3', 'wav', 'flac', 'ogg', 'opus', 'ahx', 'hvl', 'mptm', 'mod', 's3m', 'xm', 'it', 'mo3']) {
    const label = extensionLabel(extension);
    const x = Number(label.match(/translate\(([\d.]+) 98\)/)[1]);
    assert(x >= 34 && x <= 64, `${extension} label exceeds the document margins`);
  }
  assert.throws(() => extensionLabel('unknown'), /No outlined icon glyph/);
});
