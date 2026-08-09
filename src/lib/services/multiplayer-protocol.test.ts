import { describe, expect, it } from 'vitest';
import {
  MULTIPLAYER_QUEUE_MAX_ITEMS,
  MULTIPLAYER_PROTOCOL_VERSION,
  createMultiplayerMessageDecoder,
  encodeMultiplayerMessage,
  isHostMessage,
  isMultiplayerCommand,
  sanitizePlaylistItem,
  type HostMessage
} from './multiplayer-protocol';
import { isClientMessage } from './multiplayer-utils';
import { normalizeInviteCode } from './multiplayer-signaling';

describe('multiplayer protocol', () => {
  it('requires the host app version in the protocol hello', () => {
    expect(isHostMessage({
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION,
      name: 'Living room',
      appVersion: '0.3.1-b'
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

  it('accepts explicit generation-keyed delivery states', () => {
    expect(isHostMessage({
      kind: 'delivery',
      delivery: { generationId: 'one', trackId: 'track', mode: 'stream', postRaf: false, reason: null }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'delivery',
      delivery: { generationId: 'two', trackId: 'track', mode: 'source-file', postRaf: false, reason: null }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'delivery',
      delivery: { generationId: 'three', trackId: null, mode: 'none', postRaf: false, reason: 'network' }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'delivery',
      delivery: { generationId: 'four', trackId: 'track', mode: 'source-file', postRaf: true, reason: null }
    })).toBe(false);
  });

  it('accepts bounded playback preparation messages', () => {
    expect(isHostMessage({
      kind: 'playback.prepare',
      preparation: {
        generationId: 'prepare-1',
        trackId: 'track-1',
        delivery: 'source-file'
      }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'playback.prepare',
      preparation: {
        generationId: '',
        trackId: 'track-1',
        delivery: 'source-file'
      }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'playback.prepare',
      preparation: {
        generationId: 'prepare-1',
        trackId: 'track-1',
        delivery: 'buffering'
      }
    })).toBe(false);
  });

  it('accepts only bounded pairing identity messages', () => {
    expect(isHostMessage({
      kind: 'pairing',
      paired: true,
      freeplayPaired: true,
      freeplayActive: true,
      hostId: 'persistent_host-id',
      name: 'Living room'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'pairing',
      paired: true,
      freeplayPaired: false,
      freeplayActive: false,
      hostId: '../host',
      name: 'Living room'
    })).toBe(false);
  });

  it('accepts clock calibration and scheduled-start messages', () => {
    expect(isHostMessage({
      kind: 'clock.ping', generationId: 'generation', hostSentAt: 1_000
    })).toBe(true);
    expect(isClientMessage({
      kind: 'clock.pong',
      generationId: 'generation',
      hostSentAt: 1_000,
      clientReceivedAt: 1_030,
      clientSentAt: 1_031
    })).toBe(true);
    expect(isHostMessage({
      kind: 'playback.start',
      start: {
        generationId: 'generation',
        trackId: 'track',
        positionSeconds: 12.5,
        startAt: 2_000
      }
    })).toBe(true);
    expect(isHostMessage({ kind: 'playback.cancel', generationId: 'generation' })).toBe(true);
    expect(isHostMessage({
      kind: 'playback.start',
      start: {
        generationId: 'generation',
        trackId: 'track',
        positionSeconds: -1,
        startAt: 2_000
      }
    })).toBe(false);
  });

  it('requires generations on playback, readiness, ended events, and retries', () => {
    const playback = {
      kind: 'playback',
      playback: {
        generationId: 'generation',
        snapshot: {
          state: 'paused', currentTime: 0, duration: 1, volume: 1, muted: false, backend: 'stream'
        },
        track: null,
        sentAt: 1
      }
    };
    expect(isHostMessage(playback)).toBe(true);
    expect(isHostMessage({ ...playback, playback: { ...playback.playback, generationId: '' } })).toBe(false);
    expect(isClientMessage({ kind: 'playback.ready', generationId: 'generation' })).toBe(true);
    expect(isClientMessage({ kind: 'playback.ended', generationId: 'generation', trackId: 'track' })).toBe(true);
    expect(isClientMessage({ kind: 'source.retry', generationId: 'generation' })).toBe(true);
    expect(isClientMessage({ kind: 'playback.ended', trackId: 'track' })).toBe(false);
  });

  it('accepts only bounded host-authoritative listener buffers', () => {
    expect(isHostMessage({ kind: 'buffer', bufferMs: 750 })).toBe(true);
    expect(isHostMessage({ kind: 'buffer', bufferMs: 4_001 })).toBe(false);
  });

  it('bounds client-owned Freeplay queues at the protocol edge', () => {
    expect(isClientMessage({
      kind: 'freeplay.queue',
      itemIds: ['a', 'b'],
      shuffleEnabled: true,
      repeatMode: 'all'
    })).toBe(true);
    expect(isClientMessage({
      kind: 'freeplay.queue',
      itemIds: Array.from({ length: MULTIPLAYER_QUEUE_MAX_ITEMS + 1 }, () => 'a')
    })).toBe(false);
    expect(isClientMessage({ kind: 'freeplay.queue', itemIds: [''] })).toBe(false);
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
