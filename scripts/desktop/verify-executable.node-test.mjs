import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyStandaloneExecutable } from './verify-executable.mjs';

function executable(dlls, delayed = []) {
  const bytes = Buffer.alloc(4096);
  const pe = 0x80;
  const optional = pe + 24;
  const section = optional + 240;
  bytes.writeUInt16LE(0x5a4d);
  bytes.writeUInt32LE(pe, 0x3c);
  bytes.writeUInt32LE(0x4550, pe);
  bytes.writeUInt16LE(0x8664, pe + 4);
  bytes.writeUInt16LE(1, pe + 6);
  bytes.writeUInt16LE(240, pe + 20);
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeUInt32LE(16, optional + 108);
  bytes.writeUInt32LE(0xe00, section + 8);
  bytes.writeUInt32LE(0x1000, section + 12);
  bytes.writeUInt32LE(0xe00, section + 16);
  bytes.writeUInt32LE(0x200, section + 20);
  let name = 0x800;
  for (const [list, index, start, stride, nameOffset] of [
    [dlls, 1, 0x200, 20, 12], [delayed, 13, 0x400, 32, 4],
  ]) {
    if (!list.length) continue;
    bytes.writeUInt32LE(start + 0xe00, optional + 112 + index * 8);
    list.forEach((dll, i) => {
      const entry = start + i * stride;
      if (index === 13) bytes.writeUInt32LE(1, entry);
      bytes.writeUInt32LE(name + 0xe00, entry + nameOffset);
      bytes.write(`${dll}\0`, name, 'ascii');
      name += dll.length + 1;
    });
  }
  return bytes;
}

test('accepts Windows imports, API sets, mixed case and delay imports', () => {
  assert.deepEqual(verifyStandaloneExecutable(executable(
    ['KERNEL32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll'], ['DWRITE.dll'],
  )), ['api-ms-win-crt-runtime-l1-1-0.dll', 'dwrite.dll', 'kernel32.dll']);
});

test('rejects dynamic WebView2 loaders and Visual C++ redistributable dependencies', () => {
  for (const dll of ['WebView2Loader.dll', 'VCRUNTIME140.dll', 'MSVCP140.dll', 'custom.dll']) {
    assert.throws(() => verifyStandaloneExecutable(executable(['kernel32.dll', dll])), /External DLL dependency/);
    assert.throws(() => verifyStandaloneExecutable(executable(['kernel32.dll'], [dll])), /External DLL dependency/);
  }
});

test('rejects malformed and wrong-architecture executables', () => {
  assert.throws(() => verifyStandaloneExecutable(Buffer.alloc(512)), /Windows executable/);
  const bytes = executable(['kernel32.dll']);
  bytes.writeUInt16LE(0x14c, 0x84);
  assert.throws(() => verifyStandaloneExecutable(bytes), /x86-64/);
});
