import { describe, expect, it } from 'vitest';
import {
  MULTIPLAYER_QUEUE_MAX_ITEMS,
  MULTIPLAYER_PROTOCOL_MAJOR,
  MULTIPLAYER_PROTOCOL_MINOR,
  MULTIPLAYER_PROTOCOL_CAPABILITIES,
  createMultiplayerMessageDecoder,
  encodeMultiplayerMessage,
  isHostMessage,
  isMultiplayerCommand,
  sanitizeTrackItem,
  type HostMessage
} from './multiplayer-protocol';
import { isClientMessage } from './multiplayer-utils';

describe('multiplayer protocol', () => {
  it('requires protocol and implementation identity in the hello', () => {
    expect(isHostMessage({
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      capabilities: [...MULTIPLAYER_PROTOCOL_CAPABILITIES],
      impl: { product: 'izci', productVersion: '0.3.2' },
      name: 'Living room'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      capabilities: [],
      name: 'Living room'
    })).toBe(false);
    expect(isHostMessage({
      kind: 'hello',
      version: 29,
      name: 'Living room',
      appVersion: '0.3.2'
    })).toBe(false);
  });

  it('removes local file capabilities from shared tracks', () => {
    const file = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' });
    const item = sanitizeTrackItem({
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
    expect(isMultiplayerCommand({ type: 'queue.replace', commandId: '1', items: [] })).toBe(false);
  });

  it('reassembles chunked catalog messages', () => {
    const message: HostMessage = {
      kind: 'catalog',
      catalog: {
        revision: 3,
        queue: Array.from({ length: 500 }, (_, index) => ({
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

  it('accepts bounded track info and requests', () => {
    expect(isClientMessage({ kind: 'track.info.request', trackId: 'song' })).toBe(true);
    expect(isClientMessage({ kind: 'track.info.request', trackId: '' })).toBe(false);
    expect(isHostMessage({
      kind: 'track.info',
      info: { trackId: 'song', metadata: { title: 'Tagged', replayGain: { trackGainDb: -5 } }, lyrics: '[00:01.00]Line' }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'track.info', info: { trackId: 'song', metadata: {}, lyrics: 'x'.repeat(70_000) }
    })).toBe(false);
  });

  it('accepts bounded Oda backgrounds', () => {
    expect(isHostMessage({
      kind: 'oda.background',
      background: {
        dataUrl: 'data:image/jpeg;base64,AQID',
        opacity: 50
      }
    })).toBe(true);
    expect(isHostMessage({ kind: 'oda.background', background: null })).toBe(true);
    expect(isHostMessage({
      kind: 'oda.background',
      background: {
        dataUrl: 'https://example.test/background.jpg',
        opacity: 50
      }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'oda.background',
      background: {
        dataUrl: 'data:image/jpeg;base64,AQID',
        opacity: 101
      }
    })).toBe(false);
    expect(isClientMessage({
      kind: 'oda.background.preference',
      enabled: true
    })).toBe(true);
    expect(isHostMessage({ kind: 'oda.background.opacity', opacity: 75 })).toBe(true);
    expect(isHostMessage({ kind: 'oda.background.opacity', opacity: -1 })).toBe(false);
  });

  it('accepts explicit generation-keyed delivery states', () => {
    expect(isHostMessage({
      kind: 'delivery',
      delivery: { generationId: 'one', trackId: 'track', mode: 'stream', reason: null }
    })).toBe(false);
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
    expect(isHostMessage({ kind: 'playback.prepare', preparation: { generationId: 'old', trackId: 'track', delivery: 'stream' } })).toBe(false);
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

  it('accepts server hello identity extras and pair messages', () => {
    expect(isHostMessage({
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      capabilities: [...MULTIPLAYER_PROTOCOL_CAPABILITIES],
      impl: { product: 'izci', productVersion: '1.0' },
      name: 'Host',
      identity: 'host-identity-01',
      pairNonce: 'host-nonce-001'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      capabilities: [],
      impl: { product: 'izci', productVersion: '1.0' },
      name: 'Host'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      capabilities: [],
      impl: { product: 'izci', productVersion: '1.0' },
      name: 'Host',
      identity: 'bad id!'
    })).toBe(false);
    expect(isHostMessage({
      kind: 'pair.secret',
      hostIdentity: 'host-identity-01',
      secret: 'a'.repeat(64)
    })).toBe(true);
    expect(isHostMessage({
      kind: 'pair.secret',
      hostIdentity: 'host-identity-01',
      secret: 'short'
    })).toBe(false);
    expect(isHostMessage({
      kind: 'invitation',
      roomId: 'd'.repeat(32),
      secret: 'invite-1'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'invitation',
      roomId: 'short',
      secret: 'invite-1'
    })).toBe(false);
    expect(isClientMessage({
      kind: 'pair.proof',
      clientIdentity: 'client-identity-02',
      hostNonce: 'host-nonce-001',
      guestNonce: 'guest-nonce-002',
      proof: 'b'.repeat(64)
    })).toBe(true);
    expect(isClientMessage({
      kind: 'pair.proof',
      clientIdentity: 'client-identity-02',
      hostNonce: 'host-nonce-001',
      guestNonce: 'guest-nonce-002',
      proof: 'tampered'
    })).toBe(false);
  });

  it('accepts only bounded pairing identity messages', () => {
    expect(isHostMessage({
      kind: 'pairing',
      paired: true,
      freeplayActive: true,
      hostId: 'persistent_host-id',
      name: 'Living room'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'pairing',
      paired: true,
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
    expect(isHostMessage({ kind: 'buffer', bufferMs: 3_000 })).toBe(true);
    expect(isHostMessage({ kind: 'buffer', bufferMs: 30_001 })).toBe(false);
  });

  it('accepts bounded Play next commands', () => {
    expect(isMultiplayerCommand({
      type: 'queue.play-next',
      commandId: 'next-1',
      collection: 'queue',
      itemIds: ['one', 'two']
    })).toBe(true);
    expect(isMultiplayerCommand({
      type: 'queue.play-next',
      commandId: 'next-1',
      collection: 'library',
      itemIds: []
    })).toBe(false);
  });

  it('accepts bounded shared queue edits', () => {
    expect(isMultiplayerCommand({ type: 'queue.randomize', commandId: 'randomize' })).toBe(true);
    for (const type of ['queue.add', 'queue.replace', 'queue.remove']) {
      expect(isMultiplayerCommand({ type, commandId: 'edit', itemIds: ['one'] })).toBe(true);
      expect(isMultiplayerCommand({ type, commandId: 'edit', itemIds: [] })).toBe(false);
    }
  });

  it('accepts bounded host MOTD messages', () => {
    expect(isHostMessage({
      kind: 'chat.motd',
      motd: 'Welcome to the living room',
      hostName: 'Living room'
    })).toBe(true);
    expect(isHostMessage({
      kind: 'chat.motd',
      motd: 'x'.repeat(501),
      hostName: 'Living room'
    })).toBe(false);
    expect(isHostMessage({
      kind: 'chat.motd',
      motd: 'Welcome',
      hostName: 'Living\nroom'
    })).toBe(false);
  });

  it('accepts supported chat actions', () => {
    expect(isHostMessage({
      kind: 'chat.message',
      message: { id: 'one', name: 'Host', text: 'waves', sentAt: 1, action: 'me' }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'chat.message',
      message: { id: 'two', name: 'client123', text: 'joined', sentAt: 1, action: 'join' }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'chat.message',
      message: { id: 'three', name: 'client123', text: 'left', sentAt: 1, action: 'leave' }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'chat.message',
      message: {
        id: 'four',
        name: 'client123',
        text: 'After Dark',
        sentAt: 1,
        action: 'now-playing',
        track: { collection: 'queue', itemId: 'track', title: 'After Dark' }
      }
    })).toBe(true);
    expect(isHostMessage({
      kind: 'chat.message',
      message: { id: 'five', name: 'Host', text: 'waves', sentAt: 1, action: 'shrug' }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'chat.message',
      message: { id: 'six', name: 'client123', text: 'After Dark', sentAt: 1, action: 'now-playing' }
    })).toBe(false);
  });

  it('validates chat messages, history, and client submissions', () => {
    const message = {
      id: 'message-1',
      name: 'Host',
      text: 'Hello from the room',
      sentAt: 1_000
    };
    const track = {
      collection: 'library' as const,
      itemId: 'track-1',
      title: 'A song'
    };

    expect(isHostMessage({ kind: 'chat.message', message })).toBe(true);
    expect(isHostMessage({ kind: 'chat.message', message: { ...message, text: track.title, track } })).toBe(true);
    expect(isHostMessage({ kind: 'chat.history', messages: [message] })).toBe(true);
    expect(isHostMessage({ kind: 'chat.clear' })).toBe(true);
    expect(isClientMessage({ kind: 'chat.send', text: 'Hello' })).toBe(true);
    expect(isClientMessage({ kind: 'chat.send', text: track.title, track })).toBe(true);
    expect(isClientMessage({
      kind: 'chat.send',
      text: '/np',
      track,
      action: 'now-playing'
    })).toBe(true);
    expect(isClientMessage({ kind: 'chat.send', text: '/np', action: 'now-playing' })).toBe(false);
    expect(isClientMessage({ kind: 'chat.send', text: track.title, track, action: 'clear' })).toBe(false);
    expect(isClientMessage({ kind: 'chat.send', text: '  ' })).toBe(false);
    expect(isHostMessage({
      kind: 'chat.message',
      message: { ...message, text: 'x'.repeat(501) }
    })).toBe(false);
    expect(isHostMessage({
      kind: 'chat.message',
      message: { ...message, text: 'line\nbreak' }
    })).toBe(false);
    expect(isClientMessage({
      kind: 'chat.send',
      text: track.title,
      track: { ...track, title: 'line\nbreak' }
    })).toBe(false);
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

});
