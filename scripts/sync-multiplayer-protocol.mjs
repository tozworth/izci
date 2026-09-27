import { readFile, writeFile } from 'node:fs/promises';

const protocolPath = new URL('../src/lib/services/multiplayer-protocol.ts', import.meta.url);
const serverProtocolPath = new URL('../izci-server/internal/protocol/protocol.go', import.meta.url);
const checkOnly = process.argv.includes('--check');

const protocolSource = await readFile(protocolPath, 'utf8');
const majorMatch = protocolSource.match(
  /export const MULTIPLAYER_PROTOCOL_MAJOR = (\d+);/
);
const minorMatch = protocolSource.match(
  /export const MULTIPLAYER_PROTOCOL_MINOR = (\d+);/
);

if (!majorMatch || !minorMatch) {
  throw new Error('Could not find MULTIPLAYER_PROTOCOL_MAJOR/MINOR.');
}

const major = majorMatch[1];
const minor = minorMatch[1];
const serverProtocolSource = await readFile(serverProtocolPath, 'utf8');
let serverReplacements = 0;
let synchronizedServerProtocol = serverProtocolSource.replace(
  /(\bMajor\s*=\s*)\d+/g,
  (_, prefix) => {
    serverReplacements += 1;
    return `${prefix}${major}`;
  }
);
synchronizedServerProtocol = synchronizedServerProtocol.replace(
  /(\bMinor\s*=\s*)\d+/g,
  (_, prefix) => {
    serverReplacements += 1;
    return `${prefix}${minor}`;
  }
);

if (serverReplacements !== 2) {
  throw new Error(`Expected to find Go protocol Major and Minor; found ${serverReplacements}.`);
}

const serverProtocolChanged = synchronizedServerProtocol !== serverProtocolSource;

if (!serverProtocolChanged) process.exit(0);

if (checkOnly) {
  const mismatches = [];
  if (serverProtocolChanged) mismatches.push('izci-server/internal/protocol/protocol.go');
  throw new Error(`${mismatches.join(' and ')} do not use multiplayer protocol ${major}.${minor}.`);
}

await Promise.all([
  serverProtocolChanged ? writeFile(serverProtocolPath, synchronizedServerProtocol) : undefined
]);
console.log(`Synchronized multiplayer protocol consumers to ${major}.${minor}.`);
