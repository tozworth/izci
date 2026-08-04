import { describe, expect, it } from 'vitest';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  createMultiplayerMessageDecoder,
  encodeMultiplayerMessage,
  isHostMessage,
  isMultiplayerCommand,
  sanitizePlaylistItem,
  type HostMessage
} from './multiplayer-protocol';
import { normalizeInviteCode } from './multiplayer-session';

describe('multiplayer protocol', () => {
  it('requires the host app version in the protocol hello', () => {
    expect(isHostMessage({
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION,
      name: 'Living room',
      appVersion: '0.3.0'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION,
      name: 'Living room'
    })).toBe(false);
  });

  it('removes local file capabilities from shared tracks', () => {
    const file = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });
    const item = sanitizePlaylistItem({
      id: 'one',
      file,
      objectUrl: 'blob:secret',
      name: 'song.mp3',
      path: 'Music/song.mp3',
      extension: 'mp3',
      kind: 'stream',
      size: 5,
      lastModified: 1,
      metadata: { title: 'Song' }
    });

    expect(item).toMatchObject({ id: 'one', path: 'Music/song.mp3', metadata: { title: 'Song' } });
    expect(item.file).toBeUndefined();
    expect(item.fileHandle).toBeUndefined();
    expect(item.objectUrl).toBeUndefined();
  });

  it('rejects commands outside the finite command surface', () => {
    expect(isMultiplayerCommand({ type: 'transport.play', commandId: '1' })).toBe(true);
    expect(isMultiplayerCommand({ type: 'transport.pause', commandId: '1' })).toBe(true);
    expect(isMultiplayerCommand({ type: 'transport.stop', commandId: '1' })).toBe(true);
    expect(isMultiplayerCommand({ type: 'transport.volume', commandId: '1', volume: 0.5 })).toBe(false);
    expect(isMultiplayerCommand({ type: 'transport.mute', commandId: '1' })).toBe(false);
    expect(isMultiplayerCommand({ type: 'playlist.replace', commandId: '1', items: [] })).toBe(false);
  });

  it('reassembles chunked catalog messages', () => {
    const message: HostMessage = {
      kind: 'catalog',
      catalog: {
        revision: 3,
        playlist: Array.from({ length: 500 }, (_, index) => ({
          id: String(index),
          name: `song-${index}-${'x'.repeat(40)}.mp3`,
          extension: 'mp3',
          kind: 'stream' as const,
          size: 1,
          lastModified: 1
        })),
        library: [],
        favorites: [],
        shuffleEnabled: false,
        repeatMode: 'off'
      }
    };
    const frames = encodeMultiplayerMessage(message);
    const decode = createMultiplayerMessageDecoder(isHostMessage);
    const decoded = frames.map(decode).find(Boolean);

    expect(frames.length).toBeGreaterThan(1);
    expect(decoded).toEqual(message);
  });

  it('accepts bounded artwork messages and reassembles their chunked data URLs', () => {
    const message: HostMessage = {
      kind: 'artwork',
      artwork: {
        trackId: 'one',
        assetId: 'a'.repeat(64),
        dataUrl: `data:image/webp;base64,${'A'.repeat(30_000)}`,
        mimeType: 'image/webp',
        width: 1024,
        height: 1024
      }
    };
    const frames = encodeMultiplayerMessage(message);
    const decode = createMultiplayerMessageDecoder(isHostMessage);

    expect(frames.length).toBeGreaterThan(1);
    expect(frames.map(decode).find(Boolean)).toEqual(message);
    expect(isHostMessage({
      ...message,
      artwork: { ...message.artwork, dataUrl: 'https://example.test/art.webp' }
    })).toBe(false);
  });

  it('accepts explicit host audio availability states', () => {
    expect(isHostMessage({
      kind: 'audio',
      audio: { enabled: true, sourceFile: false, postRaf: false, reason: null }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'audio',
      audio: { enabled: false, sourceFile: true, postRaf: false, reason: null }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'audio',
      audio: { enabled: false, sourceFile: false, postRaf: false, reason: 'network' }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'audio',
      audio: { enabled: true, reason: null }
    })).toBe(false);
  });

  it('accepts only bounded pairing identity messages', () => {
    expect(isHostMessage({
      kind: 'pairing',
      paired: true,
      hostId: 'persistent_host-id',
      name: 'Living room'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'pairing',
      paired: true,
      hostId: '../host',
      name: 'Living room'
    })).toBe(false);
  });

  it('accepts invite codes directly or from an izci room link', () => {
    const code = 'a1b2c3d4';
    expect(normalizeInviteCode(code)).toBe(code);
    expect(normalizeInviteCode(`https://izci.example/#room=${code}`)).toBe(code);
    expect(normalizeInviteCode('A1B2C3D4')).toBeNull();
    expect(normalizeInviteCode('abcdefghijklmnopqrstuvwx')).toBeNull();
    expect(normalizeInviteCode('not a room')).toBeNull();
  });
});
