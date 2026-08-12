import { describe, expect, it } from 'vitest';
import type { MultiplayerDeliveryState, MultiplayerPlayback } from './multiplayer-protocol';
import { MultiplayerClientTransition } from './multiplayer-client-transition';

function delivery(generationId: string, mode: MultiplayerDeliveryState['mode'] = 'stream') {
  return {
    generationId,
    trackId: `track-${generationId}`,
    mode,
    reason: null
  } satisfies MultiplayerDeliveryState;
}

function playback(generationId: string): MultiplayerPlayback {
  return {
    generationId,
    track: {
      id: `track-${generationId}`,
      name: `${generationId}.mp3`,
      extension: 'mp3',
      kind: 'stream',
      size: 1,
      lastModified: 1
    },
    snapshot: {
      state: 'paused', currentTime: 0, duration: 10, volume: 1, muted: false, backend: 'stream'
    },
    sentAt: 1
  };
}

describe('MultiplayerClientTransition', () => {
  it('reuses one receiver pipeline while acknowledging each matching generation once', () => {
    const transition = new MultiplayerClientTransition();
    transition.setReceiverPipelineReady(true);

    for (const id of ['a', 'b']) {
      transition.beginDelivery(delivery(id));
      expect(transition.acceptPlayback(playback(id))).toBe(true);
      expect(transition.acceptPreparation({
        generationId: id, trackId: `track-${id}`, delivery: 'stream'
      })).toBe(true);
      expect(transition.takeReadyGeneration()).toBe(id);
      expect(transition.takeReadyGeneration()).toBeNull();
    }
  });

  it('ignores obsolete playback, preparation, source completion, and ended events', () => {
    const transition = new MultiplayerClientTransition();
    transition.beginDelivery(delivery('a', 'source-file'));
    transition.beginDelivery(delivery('b', 'source-file'));

    expect(transition.acceptPlayback(playback('a'))).toBe(false);
    expect(transition.acceptPreparation({
      generationId: 'a', trackId: 'track-a', delivery: 'source-file'
    })).toBe(false);
    expect(transition.setSourceReady('a', 'track-a', true)).toBe(false);
    expect(transition.isCurrent('a', 'track-a')).toBe(false);
  });

  it('waits for a completely loaded source file from the same generation', () => {
    const transition = new MultiplayerClientTransition();
    transition.beginDelivery(delivery('file', 'source-file'));
    transition.acceptPlayback(playback('file'));
    transition.acceptPreparation({
      generationId: 'file', trackId: 'track-file', delivery: 'source-file'
    });

    expect(transition.takeReadyGeneration()).toBeNull();
    expect(transition.setSourceReady('file', 'track-file', true)).toBe(true);
    expect(transition.takeReadyGeneration()).toBe('file');
  });

  it('acknowledges immediately when audio is refused without leaking that ack to the next generation', () => {
    const transition = new MultiplayerClientTransition();
    transition.setReceiveAudio(false);
    transition.beginDelivery(delivery('a'));
    transition.acceptPlayback(playback('a'));
    transition.acceptPreparation({ generationId: 'a', trackId: 'track-a', delivery: 'stream' });
    expect(transition.takeReadyGeneration()).toBe('a');

    transition.setReceiveAudio(true);
    transition.beginDelivery(delivery('b'));
    transition.acceptPlayback(playback('b'));
    transition.acceptPreparation({ generationId: 'b', trackId: 'track-b', delivery: 'stream' });
    expect(transition.takeReadyGeneration()).toBeNull();
  });

  it('handles stream to source-file to stream without replacing receiver readiness', () => {
    const transition = new MultiplayerClientTransition();
    transition.setReceiverPipelineReady(true);

    transition.beginDelivery(delivery('stream-a'));
    transition.acceptPlayback(playback('stream-a'));
    transition.acceptPreparation({
      generationId: 'stream-a', trackId: 'track-stream-a', delivery: 'stream'
    });
    expect(transition.takeReadyGeneration()).toBe('stream-a');

    transition.beginDelivery(delivery('file', 'source-file'));
    transition.acceptPlayback(playback('file'));
    transition.acceptPreparation({
      generationId: 'file', trackId: 'track-file', delivery: 'source-file'
    });
    expect(transition.takeReadyGeneration()).toBeNull();
    transition.setSourceReady('file', 'track-file', true);
    expect(transition.takeReadyGeneration()).toBe('file');

    transition.beginDelivery(delivery('stream-b'));
    transition.acceptPlayback(playback('stream-b'));
    transition.acceptPreparation({
      generationId: 'stream-b', trackId: 'track-stream-b', delivery: 'stream'
    });
    expect(transition.takeReadyGeneration()).toBe('stream-b');
  });

  it('allows only the last transition in rapid A to B to C preparation', () => {
    const transition = new MultiplayerClientTransition();
    transition.setReceiverPipelineReady(true);
    for (const id of ['a', 'b', 'c']) transition.beginDelivery(delivery(id));

    expect(transition.acceptPlayback(playback('b'))).toBe(false);
    expect(transition.acceptPreparation({
      generationId: 'b', trackId: 'track-b', delivery: 'stream'
    })).toBe(false);
    expect(transition.acceptPlayback(playback('c'))).toBe(true);
    expect(transition.acceptPreparation({
      generationId: 'c', trackId: 'track-c', delivery: 'stream'
    })).toBe(true);
    expect(transition.takeReadyGeneration()).toBe('c');
  });

  it('treats a generation identity as immutable', () => {
    const transition = new MultiplayerClientTransition();
    transition.beginDelivery(delivery('same'));
    expect(transition.beginDelivery({ ...delivery('same'), mode: 'source-file' })).toBeNull();
    expect(transition.acceptPlayback(playback('same'))).toBe(true);
  });

  it('does not reset readiness when an identical delivery message is replayed', () => {
    const transition = new MultiplayerClientTransition();
    transition.setReceiverPipelineReady(true);
    expect(transition.beginDelivery(delivery('same'))).toBe(true);
    transition.acceptPlayback(playback('same'));
    transition.acceptPreparation({
      generationId: 'same', trackId: 'track-same', delivery: 'stream'
    });

    expect(transition.beginDelivery(delivery('same'))).toBe(false);
    expect(transition.takeReadyGeneration()).toBe('same');
    expect(transition.beginDelivery(delivery('same'))).toBe(false);
    expect(transition.takeReadyGeneration()).toBeNull();
  });

  it('cannot turn late A source readiness into readiness for replacement C', () => {
    const transition = new MultiplayerClientTransition();
    transition.beginDelivery(delivery('a', 'source-file'));
    transition.acceptPlayback(playback('a'));
    transition.acceptPreparation({
      generationId: 'a', trackId: 'track-a', delivery: 'source-file'
    });

    transition.beginDelivery(delivery('b', 'source-file'));
    transition.beginDelivery(delivery('c', 'source-file'));
    transition.acceptPlayback(playback('c'));
    transition.acceptPreparation({
      generationId: 'c', trackId: 'track-c', delivery: 'source-file'
    });

    expect(transition.setSourceReady('a', 'track-a', true)).toBe(false);
    expect(transition.takeReadyGeneration()).toBeNull();
    expect(transition.setSourceReady('c', 'track-c', true)).toBe(true);
    expect(transition.takeReadyGeneration()).toBe('c');
  });
});
