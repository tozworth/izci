import { describe, expect, it } from 'vitest';
import {
  MULTIPLAYER_PROTOCOL_MAJOR,
  MULTIPLAYER_PROTOCOL_MINOR,
  MULTIPLAYER_PROTOCOL_CAPABILITIES,
  isCompatibleHelloIdentity,
  isHostMessage,
  isMultiplayerCommand,
  isMultiplayerCommandEnvelope,
  formatHostImplementation,
  getMissingBaselineCapabilities
} from './multiplayer-protocol';
import { isClientMessage, isIncompatibleProtocolHello } from './multiplayer-utils';

function hostHello(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'hello',
    protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
    protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
    capabilities: [...MULTIPLAYER_PROTOCOL_CAPABILITIES],
    impl: { product: 'izci', productVersion: '0.3.2' },
    name: 'Host',
    ...overrides
  };
}

function clientHello(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'hello',
    protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
    protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
    capabilities: [...MULTIPLAYER_PROTOCOL_CAPABILITIES],
    impl: { product: 'izci', productVersion: '0.3.2' },
    name: 'Phone',
    platform: 'Android',
    freeplayEnabled: false,
    ...overrides
  };
}

describe('multiplayer compatibility matrix', () => {
  it.each([
    { type: 'queue.add', itemIds: [] },
    { type: 'queue.replace', itemIds: [''] },
    { type: 'queue.remove', itemIds: ['x'.repeat(201)] },
    { type: 'queue.play-next', collection: 'other', itemIds: ['track'] },
    { type: 'transport.seek', seconds: Number.NaN },
    { type: 'collection.activate', collection: 'queue', itemId: '' }
  ])('rejects a malformed known command: $type', (payload) => {
    const command = { ...payload, commandId: 'invalid-payload' };
    expect(isMultiplayerCommandEnvelope(command)).toBe(true);
    expect(isClientMessage({ kind: 'command', command })).toBe(false);
  });

  it('admits current minor in both directions', () => {
    expect(isHostMessage(hostHello({ protocolMinor: MULTIPLAYER_PROTOCOL_MINOR + 1 }))).toBe(true);
    expect(isClientMessage(clientHello({ protocolMinor: MULTIPLAYER_PROTOCOL_MINOR + 1 }))).toBe(true);
    expect(isHostMessage(hostHello({ protocolMinor: 0 }))).toBe(true);
    expect(isIncompatibleProtocolHello(hostHello({ protocolMinor: 99 }))).toBe(false);
    expect(isCompatibleHelloIdentity({
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      capabilities: []
    })).toBe(true);
  });

  it('ignores unknown capabilities and forwards-compatible fields', () => {
    expect(isHostMessage(hostHello({
      capabilities: [...MULTIPLAYER_PROTOCOL_CAPABILITIES, 'future-cap'],
      futureField: 'ignored'
    }))).toBe(true);
    expect(isClientMessage(clientHello({
      capabilities: ['source-file', 'mystery-facility']
    }))).toBe(true);
    expect(getMissingBaselineCapabilities(['anything'])).toEqual([]);
  });

  it('nacks unsupported commands instead of dropping them', () => {
    const unsupported = {
      kind: 'command',
      command: { type: 'transport.volume', commandId: 'cmd-1', volume: 0.5 }
    };
    expect(isClientMessage(unsupported)).toBe(true);
    expect(isMultiplayerCommandEnvelope(
      (unsupported as { command: unknown }).command
    )).toBe(true);
    expect(isMultiplayerCommand(
      (unsupported as { command: unknown }).command
    )).toBe(false);
  });

  it('rejects major-version mismatch', () => {
    expect(isHostMessage(hostHello({ protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR + 1 }))).toBe(false);
    expect(isClientMessage(clientHello({ protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR + 1 }))).toBe(false);
    expect(isIncompatibleProtocolHello(hostHello({ protocolMajor: 99 }))).toBe(true);
    expect(isCompatibleHelloIdentity({
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR + 1,
      capabilities: []
    })).toBe(false);
  });

  it('applies the same hello bounds in both directions', () => {
    expect(isHostMessage(hostHello({ capabilities: null }))).toBe(false);
    expect(isClientMessage(clientHello({ capabilities: null }))).toBe(false);
    expect(isHostMessage(hostHello({
      impl: { product: 'x'.repeat(65), productVersion: '1' }
    }))).toBe(false);
    expect(isClientMessage(clientHello({
      impl: { product: 'x'.repeat(65), productVersion: '1' }
    }))).toBe(false);
    expect(isHostMessage(hostHello({ name: 'x'.repeat(49) }))).toBe(false);
    expect(isClientMessage(clientHello({ platform: 'x'.repeat(33) }))).toBe(false);
  });

  it('renders dedicated-server identity without assuming browser izci', () => {
    expect(formatHostImplementation({ product: 'izci', productVersion: '0.3.2' })).toBe('izci 0.3.2');
    expect(formatHostImplementation({ product: 'izci-server', productVersion: '0.3.2' })).toBe(
      'izci dedicated server 0.3.2'
    );
    expect(formatHostImplementation(null)).toBe('—');
    expect(isHostMessage(hostHello({
      impl: { product: 'izci-server', productVersion: '0.3.2' },
      name: 'Party box'
    }))).toBe(true);
  });
});
