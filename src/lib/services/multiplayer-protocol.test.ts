import { describe, expect, it } from 'vitest';
import {
  MULTIPLAYER_QUEUE_MAX_ITEMS,
  MULTIPLAYER_PROTOCOL_VERSION,
  createMultiplayerMessageDecoder,
  encodeMultiplayerMessage,
  isHostMessage,
  isMultiplayerCommand,
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
      appVersion: '0.3.2'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION,
      name: 'Living room'
    })).toBe(false);
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
    const frames = encodeMultiplayerMessage(message, () => 'catalog-transfer');
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
    const frames = encodeMultiplayerMessage(message, () => 'artwork-transfer');
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
      delivery: { generationId: 'one', trackId: 'track', mode: 'stream', reason: null }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'delivery',
      delivery: { generationId: 'two', trackId: 'track', mode: 'source-file', reason: null }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'delivery',
      delivery: { generationId: 'three', trackId: null, mode: 'none', reason: 'network' }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'delivery',
      delivery: { generationId: 'four', trackId: 'track', mode: 'source-file', reason: 'host-disabled' }
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
        delivery: 'render'
      }
    })).toBe(true);
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

  it('accepts the full bounded track metadata DTO', () => {
    const track = {
      id: 'track',
      name: 'module.it',
      path: 'Music/module.it',
      extension: 'it',
      kind: 'module',
      size: 2048,
      lastModified: 1_700_000_000_000,
      rating: 4.5,
      subsong: 2,
      metadata: {
        title: 'Title',
        artist: 'Artist',
        album: 'Album',
        albumArtist: 'Album artist',
        genre: 'Genre',
        year: '1998',
        trackNumber: '3/9',
        discNumber: '1/1',
        composer: 'Composer',
        embeddedMetadataLoaded: true,
        trackerType: 'Impulse Tracker',
        originalType: 'IT',
        message: 'Tracker message',
        duration: 123.5,
        bitrate: 192,
        channels: 32,
        tracks: 1,
        patterns: 12,
        instruments: 24,
        orders: 15,
        subsongs: 3,
        subsongNames: ['Main', 'Loop', 'Outro'],
        rows: 768,
        sampleRate: 48_000,
        playCount: 7,
        replayGain: {
          trackGainDb: -3.5,
          trackPeak: 0.95,
          albumGainDb: -2,
          albumPeak: 1
        }
      }
    };
    expect(isHostMessage({
      kind: 'catalog',
      catalog: {
        revision: 1,
        playlist: [track],
        library: [],
        favorites: [],
        shuffleEnabled: false,
        repeatMode: 'off'
      }
    })).toBe(true);
  });

  it('rejects application-only track fields and non-finite wire numbers', () => {
    const track = {
      id: 'track',
      name: 'song.mp3',
      extension: 'mp3',
      kind: 'stream',
      size: 1,
      lastModified: 1
    };
    const catalog = {
      revision: 1,
      playlist: [track],
      library: [],
      favorites: [],
      shuffleEnabled: false,
      repeatMode: 'off'
    };
    expect(isHostMessage({
      kind: 'catalog',
      catalog: { ...catalog, playlist: [{ ...track, objectUrl: 'blob:secret' }] }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'catalog',
      catalog: { ...catalog, revision: Number.POSITIVE_INFINITY }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'catalog',
      catalog: { ...catalog, playlist: [{ ...track, metadata: { duration: Number.NaN } }] }
    })).toBe(false);
  });

  it('rejects non-finite and out-of-range playback snapshot numbers', () => {
    const playback = {
      generationId: 'generation',
      snapshot: {
        state: 'playing',
        currentTime: 1,
        duration: 2,
        volume: 1,
        muted: false,
        backend: 'stream'
      },
      track: null,
      sentAt: 1
    };
    expect(isHostMessage({
      kind: 'playback',
      playback: { ...playback, sentAt: Number.NaN }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'playback',
      playback: {
        ...playback,
        snapshot: { ...playback.snapshot, currentTime: Number.POSITIVE_INFINITY }
      }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'playback',
      playback: { ...playback, snapshot: { ...playback.snapshot, volume: 1.1 } }
    })).toBe(false);
  });

  it('accepts only bounded host-authoritative listener buffers', () => {
    expect(isHostMessage({ kind: 'buffer', bufferMs: 750 })).toBe(true);
    expect(isHostMessage({ kind: 'buffer', bufferMs: 3_000 })).toBe(true);
    expect(isHostMessage({ kind: 'buffer', bufferMs: 30_001 })).toBe(false);
  });

  it('validates buffered Opus manifests', () => {
    const manifest = {
      generationId: 'generation',
      renderId: 'render-1',
      trackId: 'track',
      sourceRevision: '2:100:200:0',
      codec: 'opus',
      container: 'webm',
      durationMs: 12_000,
      bitrateKbps: 128,
      clusterDurationMs: 1_000,
      clusters: [
        { index: 0, timeMs: 0, sizeBytes: 10 },
        { index: 1, timeMs: 1000, sizeBytes: 10 }
      ],
      initSizeBytes: 5,
      totalBytes: 25
    };
    expect(isHostMessage({ kind: 'render.manifest', manifest })).toBe(true);
    expect(isHostMessage({ kind: 'render.manifest', manifest: { ...manifest, codec: 'vorbis' } })).toBe(false);
    expect(isHostMessage({ kind: 'render.manifest', manifest: { ...manifest, sourceRevision: '' } })).toBe(false);
    expect(isHostMessage({
      kind: 'render.manifest',
      manifest: { ...manifest, clusters: [{ index: 4, timeMs: 0, sizeBytes: 10 }], totalBytes: 15 }
    })).toBe(false);
    expect(isHostMessage({ kind: 'render.manifest', manifest: { ...manifest, totalBytes: 24 } })).toBe(false);
    expect(isHostMessage({
      kind: 'render.manifest',
      manifest: {
        ...manifest,
        clusters: [
          { index: 0, timeMs: 5_000, sizeBytes: 1 },
          { index: 1, timeMs: 1_000, sizeBytes: 1 }
        ]
      }
    })).toBe(false);
  });

  it('accepts client render needs and readiness only with valid shapes', () => {
    const need = {
      generationId: 'generation',
      renderId: 'render-1',
      epoch: 3,
      targetTimeMs: 5_000,
      aheadMs: 3_000,
      ranges: [[0, 2], [5, 9]]
    };
    expect(isClientMessage({ kind: 'render.need', need })).toBe(true);
    expect(isClientMessage({ kind: 'render.need', need: { ...need, epoch: -1 } })).toBe(false);
    expect(isClientMessage({ kind: 'render.need', need: { ...need, ranges: [[5, 2]] } })).toBe(false);
    expect(isClientMessage({
      kind: 'render.ready',
      generationId: 'generation',
      renderId: 'render-1',
      epoch: 3,
      positionMs: 5_000
    })).toBe(true);
    expect(isClientMessage({
      kind: 'render.ready',
      generationId: 'generation',
      renderId: 'render-1',
      epoch: 3.5,
      positionMs: 5_000
    })).toBe(false);
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
