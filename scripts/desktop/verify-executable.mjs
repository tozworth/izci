import assert from 'node:assert/strict';

const systemDlls = new Set([
  'advapi32.dll', 'bcrypt.dll', 'bcryptprimitives.dll', 'combase.dll', 'comctl32.dll',
  'crypt32.dll', 'dwmapi.dll', 'dwrite.dll', 'gdi32.dll', 'imm32.dll', 'kernel32.dll',
  'ntdll.dll', 'ole32.dll', 'oleaut32.dll', 'shell32.dll', 'shlwapi.dll', 'user32.dll',
  'userenv.dll', 'uxtheme.dll', 'version.dll', 'winhttp.dll', 'winmm.dll', 'ws2_32.dll',
]);

// Inspect the original PE before packing: UPX rebuilds its imports at startup.
export function verifyStandaloneExecutable(bytes) {
  assert.equal(bytes.readUInt16LE(0), 0x5a4d, 'Expected a Windows executable.');
  const pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.readUInt32LE(pe), 0x4550, 'Missing PE header.');
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Desktop builds require x86-64.');
  const optional = pe + 24;
  assert.equal(bytes.readUInt16LE(optional), 0x20b, 'Expected PE32+.');
  const sections = optional + bytes.readUInt16LE(pe + 20);
  function offset(rva) {
    for (let i = 0; i < bytes.readUInt16LE(pe + 6); i++) {
      const section = sections + i * 40;
      const address = bytes.readUInt32LE(section + 12);
      const length = Math.max(bytes.readUInt32LE(section + 8), bytes.readUInt32LE(section + 16));
      if (rva >= address && rva < address + length) return bytes.readUInt32LE(section + 20) + rva - address;
    }
    throw new Error(`Invalid PE address: ${rva}`);
  }
  const imports = new Set();
  // Both normal imports and delay-loaded DLLs must be supplied by Windows.
  for (const [index, stride, nameOffset] of [[1, 20, 12], [13, 32, 4]]) {
    const rva = bytes.readUInt32LE(optional + 112 + index * 8);
    if (!rva) continue;
    for (let entry = offset(rva); bytes.readUInt32LE(entry + nameOffset); entry += stride) {
      if (index === 13) assert.equal(bytes.readUInt32LE(entry) & 1, 1, 'Expected RVA-based delay imports.');
      const start = offset(bytes.readUInt32LE(entry + nameOffset));
      const end = bytes.indexOf(0, start);
      assert(end >= start, 'Unterminated DLL name.');
      const dll = bytes.subarray(start, end).toString('ascii').toLowerCase();
      assert(systemDlls.has(dll) || /^(?:api|ext)-ms-win-[a-z0-9-]+\.dll$/.test(dll),
        `External DLL dependency: ${dll}. The desktop executable must work with Windows and WebView2 alone.`);
      imports.add(dll);
    }
  }
  assert(imports.size > 0, 'Executable has no DLL imports.');
  return [...imports].sort();
}
